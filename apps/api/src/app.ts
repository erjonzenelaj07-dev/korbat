import type { MeResponse } from "@korbat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { ModerationError, type Moderation } from "./moderation";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";
import type { Staff } from "./staff";

/** JSON requests are small; the one raw upload route counts its own bytes and is exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The staff console's paths (3a design, section 5): /api/staff and everything under it, never a path that merely begins
 * with the same letters. The app's CORS and session resolution pass over them, so a staff route never meets the app's
 * credentialed CORS, its Origin allow-list, its session or its CSRF check: the staff gate and the staff session are the
 * only origin and session logic there. Everything else in the chain (request id, access log, client identity, security
 * headers, no-store, the body limit, the global rate limit) applies to them as to any path.
 */
const isStaffPath = (path: string) => path === "/api/staff" || path.startsWith("/api/staff/");

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
  auth: Auth;
  /** Posting and feed. Optional so auth-only tests need no database for it; the server always wires it. */
  social?: Social;
  /** Image uploads. Optional for the same reason; the server always wires it. */
  media?: Media;
  /** The account lifecycle (the data export). Optional for the same reason; the server always wires it. */
  account?: Account;
  /** The staff console's API. Mounted only while CONSOLE_ORIGIN is set; optional as the other modules are. */
  staff?: Staff;
  /** Reports and notices. Optional as the other modules are; the server always wires it, whether the console is on or off. */
  moderation?: Moderation;
  /** Checks that report a part being down without marking the API unhealthy, the image worker for one. */
  advisoryChecks?: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, staff, moderation, advisoryChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(auth.clientIdentity);
  app.use(securityHeaders, noStore);
  const appCors = cors({ origin: config.TRUSTED_ORIGINS, credentials: true });
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : appCors(c, next)));
  const jsonBodies = bodyLimit({
    maxSize: JSON_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody("payload_too_large", "The request body is too large", (c as typeof c & { get(key: "requestId"): string }).get("requestId")), 413),
  });
  app.use((c, next) => (c.req.method === "POST" && c.req.path === "/api/media" ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  app.use((c, next) => (isStaffPath(c.req.path) ? next() : auth.resolveSession(c, next)));

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION, advisoryChecks));
  app.route("/api/auth", auth.routes);
  // 3e (design, section 7.12): /api/me from the auth module's meFor and the moderation module's standingFor, read at
  // every request; null without the moderation module (an app built for some tests) or without a profile.
  app.get("/api/me", auth.requireOnboarding, async (c) => {
    const session = c.get("session")!;
    const base = await auth.meFor(session);
    const standing = moderation && base.profile !== null ? await moderation.standingFor(session.userId) : null;
    return c.json({ ...base, standing } satisfies MeResponse);
  });
  if (media) app.route("/api/media", media.routes);
  if (account) app.route("/api/account", account.routes);
  // The console is off while CONSOLE_ORIGIN is unset: nothing is mounted, and every staff path is the unknown route below.
  if (staff && config.CONSOLE_ORIGIN !== undefined) app.route("/api/staff", staff.routes(config.CONSOLE_ORIGIN));
  // Reports and notices are taken, kept and given receipts whether or not the console is on: anyone may send one, signed
  // in or not, so these routes stand after session resolution and behind no session guard of their own.
  if (moderation) app.route("/api", moderation.routes);
  if (social) app.route("/api", social.routes);

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    if (err instanceof AuthError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof HTTPException) return c.json(errorBody("invalid_request", err.message, c.get("requestId")), err.status);
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // The account routes render nothing themselves: their own errors and those of the three modules they call all land here.
    if (err instanceof AccountError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // A moderation flow's refusal, from the app's routes or from the console's case routes.
    if (err instanceof ModerationError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
