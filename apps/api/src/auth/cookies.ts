import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, safeEqual } from "./crypto";

/** Sent as `__Host-korbat_session` and `__Host-korbat_csrf`: Secure, Path=/, no Domain. */
export const SESSION_COOKIE = "korbat_session";
export const CSRF_COOKIE = "korbat_csrf";
export const CSRF_HEADER = "x-csrf-token";

const hostCookie = { path: "/", secure: true, sameSite: "Lax", prefix: "host" } as const;

/** Issues the HttpOnly session cookie and a fresh, script-readable CSRF cookie. */
export function setSessionCookies(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, { ...hostCookie, httpOnly: true, maxAge: maxAgeSeconds });
  setCookie(c, CSRF_COOKIE, randomToken(32), { ...hostCookie, httpOnly: false, maxAge: maxAgeSeconds });
}

/**
 * Extends both cookies after the session's idle expiry slid. The CSRF token keeps its value so
 * requests the page already has in flight stay valid.
 */
export function refreshSessionCookies(c: Context, token: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, { ...hostCookie, httpOnly: true, maxAge: maxAgeSeconds });
  const csrf = getCookie(c, CSRF_COOKIE, "host");
  if (csrf) setCookie(c, CSRF_COOKIE, csrf, { ...hostCookie, httpOnly: false, maxAge: maxAgeSeconds });
}

export function clearSessionCookies(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, hostCookie);
  deleteCookie(c, CSRF_COOKIE, hostCookie);
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE, "host");
}

/**
 * For state-changing requests authenticated by cookie: the Origin must be allowed and the
 * X-CSRF-Token header must equal the CSRF cookie (double submit).
 */
export function checkCsrf(c: Context, allowedOrigins: readonly string[]): boolean {
  const origin = c.req.header("origin");
  if (!origin || !allowedOrigins.includes(origin)) return false;
  const cookie = getCookie(c, CSRF_COOKIE, "host");
  const header = c.req.header(CSRF_HEADER);
  return Boolean(cookie && header && safeEqual(cookie, header));
}

/** The bearer token from `Authorization: Bearer kb1_...`, or undefined when absent or malformed. */
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (!header) return undefined;
  return /^Bearer (kb1_[A-Za-z0-9_-]{43})$/.exec(header)?.[1];
}
