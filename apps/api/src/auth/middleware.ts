import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { authErrorMessage, type AuthDeps } from "./context";
import { bearerToken, checkCsrf, readSessionCookie, refreshSessionCookies } from "./cookies";
import { SESSION_IDLE_MS } from "./sessions";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Runs on every request. Refuses state-changing requests whose Origin is not allowed, resolves the
 * session from a bearer token (native) or the `__Host-` cookie (web), and requires the CSRF token on
 * cookie-authenticated state changes. Sets `session` and `authVia` on the context.
 */
export function resolveSession(deps: AuthDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("session", null);
    c.set("authVia", null);
    const stateChanging = !SAFE_METHODS.has(c.req.method);
    const origin = c.req.header("origin");
    if (stateChanging && origin && !deps.config.allowedOrigins.includes(origin)) {
      return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
    }

    const bearer = bearerToken(c);
    const token = bearer ?? readSessionCookie(c);
    if (token) {
      const resolved = await deps.sessions.resolve(token);
      if (resolved) {
        if (!bearer && stateChanging && !checkCsrf(c, deps.config.allowedOrigins)) {
          return c.json(errorBody("csrf_failed", authErrorMessage("csrf_failed"), c.get("requestId")), 403);
        }
        c.set("session", resolved.session);
        c.set("authVia", bearer ? "bearer" : "cookie");
        if (resolved.slid && !bearer) refreshSessionCookies(c, token, Math.floor(SESSION_IDLE_MS / 1000));
      }
    }
    await next();
  });
}

/** Any signed-in session, including one whose account has not chosen a handle yet. */
export const requireOnboarding = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  await next();
});

/** A signed-in session whose account has finished onboarding. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  if (!session.onboarded) return c.json(errorBody("onboarding_required", authErrorMessage("onboarding_required"), c.get("requestId")), 403);
  await next();
});

/** The session proved a credential within the last `maxAgeSeconds` (300, five minutes, by default). */
export function requireFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    if (!deps.sessions.isFresh(session, windowMs)) {
      return c.json(errorBody("reauth_required", authErrorMessage("reauth_required"), c.get("requestId")), 403);
    }
    await next();
  });
}

/** Moderator or admin, with MFA on. Guards every staff route from sub-project 3 onward. */
export const requireStaffMfa = createMiddleware<AppEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  if (session.role === "user") return c.json(errorBody("forbidden", "Staff only", c.get("requestId")), 403);
  if (!session.mfaEnabled) return c.json(errorBody("staff_mfa_required", authErrorMessage("staff_mfa_required"), c.get("requestId")), 403);
  await next();
});
