import { createMiddleware } from "hono/factory";
import { AuthError } from "../auth";
import type { AppEnv } from "../env";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * The staff gate (3a design, section 7): every request under /api/staff, with or without a session, passes it before any
 * flow runs or any session is read.
 *
 * - Its Host header, port included, must be the console's host; any other is answered with the 404 of an unknown route,
 *   the same as a console that is off, so a page cannot tell the two apart. The header itself is read, never
 *   X-Forwarded-Host: Caddy and cloudflared pass Host on unchanged.
 * - An Origin, when present, must be exactly CONSOLE_ORIGIN, and anything but GET and HEAD must carry one.
 * - A Sec-Fetch-Site, when present, must be same-origin. Browsers send it; Node's fetch and old browsers send none, and
 *   fall back on the Origin test, the staff CSRF header and the absence of CORS.
 *
 * A request that fails the Origin or fetch-metadata test is refused with csrf_failed and touches no session, so a page on
 * another origin of the same site (the app on a subdomain, any localhost port in development) can neither act nor keep a
 * staff session from going idle.
 */
export function staffGate(consoleOrigin: string) {
  // CONSOLE_ORIGIN is stored exactly as browsers send Origin (config.ts), so both tests below compare strings.
  const host = new URL(consoleOrigin).host;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.header("host") !== host) return c.notFound();
    const origin = c.req.header("origin");
    if (origin === undefined ? !SAFE_METHODS.has(c.req.method) : origin !== consoleOrigin) throw new AuthError("csrf_failed", 403);
    const site = c.req.header("sec-fetch-site");
    if (site !== undefined && site !== "same-origin") throw new AuthError("csrf_failed", 403);
    await next();
  });
}
