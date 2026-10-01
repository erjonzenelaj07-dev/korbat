import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken, safeEqual } from "../crypto";

/**
 * The staff console's cookies (3a design, sections 2 and 7), sent as `__Host-korbat_staff` and `__Host-korbat_staff_csrf`:
 * names of their own, so neither is ever read as the app's, and SameSite=Strict, so no other site's page sends them. In
 * development the app and the console share the host localhost and so each other's cookies; the names, the staff gate
 * and the staff CSRF header keep them apart there. requireStaff is the only reader of the session cookie.
 */
export const STAFF_SESSION_COOKIE = "korbat_staff";
export const STAFF_CSRF_COOKIE = "korbat_staff_csrf";
/** The header the console echoes the staff CSRF cookie in; never the app's x-csrf-token. */
export const STAFF_CSRF_HEADER = "x-staff-csrf";

/**
 * Both cookies last the session's absolute limit, 12 hours, and are never refreshed: the server holds the idle limit, and a
 * cookie that outlived its session would only be refused at its next request.
 */
export const STAFF_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

const staffCookie = { path: "/", secure: true, sameSite: "Strict", prefix: "host" } as const;

/** Issues the HttpOnly session cookie and a fresh CSRF cookie the console's page can read, at sign-in only. */
export function setStaffCookies(c: Context, token: string): void {
  setCookie(c, STAFF_SESSION_COOKIE, token, { ...staffCookie, httpOnly: true, maxAge: STAFF_COOKIE_MAX_AGE_SECONDS });
  setCookie(c, STAFF_CSRF_COOKIE, randomToken(32), { ...staffCookie, httpOnly: false, maxAge: STAFF_COOKIE_MAX_AGE_SECONDS });
}

/** Expires both, at sign-out and whenever a staff session is refused, so the console shows its sign-in. */
export function clearStaffCookies(c: Context): void {
  deleteCookie(c, STAFF_SESSION_COOKIE, staffCookie);
  deleteCookie(c, STAFF_CSRF_COOKIE, staffCookie);
}

/** The staff session's token from its `__Host-` cookie; never a bearer token, never the app's session cookie. */
export function readStaffCookie(c: Context): string | undefined {
  return getCookie(c, STAFF_SESSION_COOKIE, "host");
}

/**
 * The double submit for a staff write: the x-staff-csrf header must equal the staff CSRF cookie. The Origin was checked by
 * the staff gate before this runs, so only the console's own page, which can read the cookie, passes.
 */
export function checkStaffCsrf(c: Context): boolean {
  const cookie = getCookie(c, STAFF_CSRF_COOKIE, "host");
  const header = c.req.header(STAFF_CSRF_HEADER);
  return Boolean(cookie && header && safeEqual(cookie, header));
}
