import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { authErrorMessage, type AuthDeps } from "./context";
import { bearerToken, checkCsrf, readSessionCookie, refreshSessionCookies } from "./cookies";
import { SESSION_IDLE_MS, type ReauthNeeded } from "./sessions";

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

/** The refusal both freshness guards answer: the level the route asks for and the factors proven in time, so the app can ask for what is missing. */
const reauthRequired = (c: Context<AppEnv>, needed: ReauthNeeded) => c.json(errorBody("reauth_required", authErrorMessage("reauth_required"), c.get("requestId"), needed), 403);

/** The session proved a factor within the last `maxAgeSeconds` (300, five minutes, by default): level 1. */
export function requireFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, 1, windowMs);
    if (needed) return reauthRequired(c, needed);
    await next();
  });
}

/**
 * Level 2 within the window when the account has TOTP (a second factor beside a first, or a user-verified passkey), and
 * level 1 otherwise: what the routes of the 1c design's section 10 ask for.
 */
export function requireStrongFreshAuth(deps: AuthDeps, maxAgeSeconds?: number) {
  const windowMs = maxAgeSeconds === undefined ? undefined : maxAgeSeconds * 1000;
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
    const needed = deps.sessions.reauthNeeded(session, deps.sessions.requiredLevel(session), windowMs);
    if (needed) return reauthRequired(c, needed);
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
