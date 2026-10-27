import { Platform } from "react-native";
import { ErrorEnvelope, HealthResponse, type AuthErrorCode, type MediaErrorCode, type ModerationErrorCode } from "@korbat/contracts";
import { AUTO_WORDS, UPLOAD_TEXTS } from "./moderation-words";
import { NOT_APPEALABLE } from "./orders";
import type { z } from "zod";

/** Same origin on web (Caddy proxies /api). Native needs an absolute URL. */
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://localhost:3000");

const CSRF_COOKIE = "__Host-korbat_csrf";
const DEVICE_KEY = "korbat.deviceId";

/** Browser globals, typed locally so this file does not depend on the DOM type library. */
const web = globalThis as unknown as {
  document?: { cookie: string };
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  crypto: { getRandomValues<T extends Uint8Array>(array: T): T };
};

let onUnauthenticated: (() => void) | null = null;
let onSuspended: (() => void) | null = null;

/**
 * 3e (design, sections 7.2 and 9.1): called when a write answers 403 account_suspended. The refusal carries no detail;
 * the session provider registers this to read /api/me again, which carries the standing fresh from the row.
 */
export function setSuspendedHandler(handler: (() => void) | null): void {
  onSuspended = handler;
}

/**
 * Called when a request outside the sign-in flow answers 401: the session ended elsewhere (signed
 * out everywhere, revoked, expired). The session provider registers it to drop the signed-in state.
 */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/** A failed API call with the server's error code and a message fit to show the user. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds until the request may be repeated, from Retry-After: a rate limit or the handle cooldown. */
    readonly retryAfter?: number,
    /** What the server sent beside the code (1c design, section 7.1): for reauth_required the level and the factors held, for passkey_limit the bound and its wait. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Partial<Record<AuthErrorCode | ModerationErrorCode | MediaErrorCode | "account_suspended" | "unauthenticated" | "invalid_request" | "not_found" | "internal" | "network", string>> = {
  invalid_code: "That code is not valid. Check the latest email or request a new code.",
  code_expired: "That code has expired. Request a new one.",
  too_many_attempts: "Too many attempts. Start again.",
  invalid_credentials: "Email or password is incorrect.",
  mfa_required: "Turn on two-factor authentication first.",
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
  // 3e (design, sections 9.5 and 9.8): a handle korbat retired, refused to everyone, its former holder included.
  handle_retired: "That handle was retired by korbat. Nobody can use it.",
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
  // Passkeys (1c design, section 9). The cap's sentence; the daily bound's wait is worded by messageFor from the details.
  passkey_invalid: "That passkey did not work. Try again or use your email.",
  passkey_unsupported: "This passkey provider is not supported. Try another one.",
  passkey_limit: "You have 10 passkeys. Remove one to add another.",
  passkey_suspended: "This passkey was switched off because a copy of it may exist. Remove it and add a new one.",
  passkey_not_found: "That passkey is gone.",
  challenge_expired: "That took too long. Try again.",
  // Reports and notices (3c design, section 9): the codes a person who reports can meet. The report form words three
  // failures itself, with the users' contact address: the human check, the limits and an API that cannot take reports.
  notice_link_invalid: "That link does not name a post or a profile on korbat.",
  notice_link_offsite: "Only links to this korbat can be reported.",
  human_check_failed: "We could not verify that you are human. Try again.",
  already_reported: "You already reported this; it is being looked at.",
  staff_cannot_report: "A staff account does not send reports. Open a finding in the staff console instead.",
  notice_not_found: "We could not find a report with this link.",
  // Appeals and re-examination (3c design, section 9): one answer for every reason one is not open.
  appeal_not_open: "This decision cannot be appealed now.",
  appeal_exists: "You have already appealed this decision.",
  reexamination_not_open: "A re-examination cannot be asked for this item now.",
  reexamination_exists: "A re-examination of this item has already been asked for.",
  // 3e Task 4 (design, section 9.8): one answer for every reason a reply is not open.
  reply_not_open: "You cannot reply to this decision: you already replied, or it has ended or was lifted.",
  // 3d Task 6 (design, section 9.7): [auto.decided] without the day, for every reason "Ask for a person" is not open.
  objection_not_open: AUTO_WORDS.notOpen,
  // 3d review L10: a second request while the first is open, in the app's own words.
  objection_exists: AUTO_WORDS.exists,
  // 3d Task 7 (design, section 9.7): [upload.refusedPost], a post sent with a refused upload attached.
  upload_refused: UPLOAD_TEXTS.refusedPost,
  // 3f (design, section 9.4): an appeal sent against an order's notice by hand; the screen offers none.
  not_appealable: NOT_APPEALABLE,
  // 3e (design, section 9.8): the fallback when /me cannot be read; with it the screens say until when (9.4).
  account_suspended: "Your account is suspended, so you cannot do this now.",
  // 3e Task 5 (design, section 9.8): [report.restricted] without its date, which the report form adds from /me (9.6).
  reporting_restricted:
    'korbat has restricted your reports under its rules, after a warning, because several of them were plainly unfounded. The decision is under Settings, Cases, where you can appeal it. You can still report illegal content: choose "It is illegal". For the sexual abuse or exploitation of a child, choose the third answer.',
  unauthenticated: "Sign in to continue.",
  invalid_request: "Some details are missing or invalid.",
  not_found: "That no longer exists.",
  internal: "Something went wrong on our side. Try again.",
  network: "Cannot reach korbat. Check your connection.",
};

/** The daily passkey bound as the API details it: 5 added in a day, and the seconds until the day has a slot again. */
function dailyPasskeyBound(details: unknown): number | null {
  const bound = details as { reason?: unknown; retryAfter?: unknown } | null;
  return bound && typeof bound === "object" && bound.reason === "daily" && typeof bound.retryAfter === "number" && bound.retryAfter > 0 ? bound.retryAfter : null;
}

/** The message for a code; `details` is what the server sent beside it, which turns the daily passkey bound into its wait in hours. */
export function messageFor(code: string, fallback?: string, details?: unknown): string {
  const wait = code === "passkey_limit" ? dailyPasskeyBound(details) : null;
  if (wait !== null) {
    const hours = Math.max(1, Math.ceil(wait / 3600));
    return `You added 5 passkeys today. You can add another in about ${hours === 1 ? "1 hour" : `${hours} hours`}.`;
  }
  return MESSAGES[code as keyof typeof MESSAGES] ?? fallback ?? "Something went wrong. Try again.";
}

/**
 * The codes worded here rather than by the server: validation and internal errors, whose server messages are technical;
 * the passkey bounds, whose daily wait is worded from the details; and (3e's review, people7) a report refused for the
 * restriction of reporting and a reply that is not open, whose screens print the app's own sentences of the design.
 */
function localWording(code: string): boolean {
  return code === "invalid_request" || code === "internal" || code === "passkey_limit" || code === "reporting_restricted" || code === "reply_not_open" || code === "objection_not_open" || code === "objection_exists" || code === "upload_refused";
}

/** The message to show for any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Try again.";
}

function readCookie(name: string): string | undefined {
  const cookies = web.document?.cookie;
  if (!cookies) return undefined;
  for (const part of cookies.split("; ")) {
    const separator = part.indexOf("=");
    if (part.slice(0, separator) === name) return decodeURIComponent(part.slice(separator + 1));
  }
  return undefined;
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 32 random bytes as unpadded base64url (43 characters). */
function randomDeviceId(): string {
  const bytes = web.crypto.getRandomValues(new Uint8Array(33));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += BASE64URL[(n >> 18) & 63]! + BASE64URL[(n >> 12) & 63]! + BASE64URL[(n >> 6) & 63]! + BASE64URL[n & 63]!;
  }
  return out.slice(0, 43);
}

/** A random id created once per browser. The server stores only a keyed hash of it. */
export function deviceId(): string {
  try {
    const existing = web.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^[A-Za-z0-9_-]{22,64}$/.test(existing)) return existing;
    const created = randomDeviceId();
    web.localStorage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return randomDeviceId();
  }
}

export const platform: "web" | "ios" | "android" = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

interface RequestOptions<T> {
  /** 3b Task 7: PUT for an import's chunk and pick (3b design, section 9.2). */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  /** A raw body sent as it is, with its declared type: how an image is uploaded. */
  raw?: { type: string; body: Blob };
  /**
   * 3b Task 7: request headers of the caller's own, in lower case, beside the type and the CSRF echo this function sets: an
   * import's chunk carries Import-Offset and Import-Chunk-Sha256 (3b design, section 7.3).
   */
  headers?: Record<string, string>;
  /** Schema for a JSON response body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
}

/**
 * Calls the API with the session cookie and answers with the raw response, for a body that is not
 * JSON (the account export's ZIP). State-changing requests echo the CSRF cookie in X-CSRF-Token; the
 * session cookie itself is HttpOnly and never readable here. A failed call throws an ApiError.
 */
export async function apiResponse(path: string, options: Omit<RequestOptions<unknown>, "schema"> = {}): Promise<Response> {
  const method = options.method ?? (options.json === undefined && options.raw === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { ...options.headers };
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.raw) headers["content-type"] = options.raw.type;
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["x-csrf-token"] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
    });
  } catch {
    throw new ApiError(0, "network", messageFor("network"));
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && path !== "/api/me") onUnauthenticated?.();
    const parsed = ErrorEnvelope.safeParse(await res.json().catch(() => null));
    const code = parsed.success ? parsed.data.error.code : "internal";
    const details = parsed.success ? parsed.data.error.details : undefined;
    // 3e: a write refused for a running suspension: /me is read again, so the screens say until when.
    if (res.status === 403 && code === "account_suspended") onSuspended?.();
    // The server's message is written for people and can be more specific than the generic text for
    // its code ("Two-factor setup expired. Start again."). Only the codes localWording names use the
    // local wording.
    const local = localWording(code) || !parsed.success;
    // Retry-After is whole seconds: on a rate limit, and on the handle cooldown, where it says when the next change is allowed.
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ApiError(res.status, code, local ? messageFor(code, undefined, details) : parsed.data.error.message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, details);
  }
  return res;
}

/** Calls the API as `apiResponse` does and parses the JSON answer with `schema`; omit it for a 204 response. */
export async function api<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const res = await apiResponse(path, options);
  if (!options.schema) return undefined as T;
  return options.schema.parse(await res.json());
}

export async function fetchHealth(): Promise<HealthResponse> {
  return api("/api/health", { schema: HealthResponse });
}
