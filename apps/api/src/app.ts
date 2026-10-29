import type { MeResponse } from "@korbat/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { AccountError, type Account } from "./account";
import { ActivityError, type Activity } from "./activity";
import { AuthError, type Auth } from "./auth";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { ImportError, type Imports } from "./imports";
import { errorBody } from "./lib/errors";
import { MediaError, type Media } from "./media";
import { observability } from "./middleware/observability";
import { clientIpKey, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { ModerationError, type Moderation } from "./moderation";
import { healthRoutes, type HealthChecks } from "./routes/health";
import { SocialError, type Social } from "./social";
import type { Staff } from "./staff";
import type { Transparency } from "./transparency";

/** JSON requests are small; the two raw upload routes count their own bytes and are exempt. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * 3b (design, section 7.3): a chunk of an import's archive, PUT /api/imports/<id>/archive with the id as a lowercase
 * UUID's 36 characters, the pattern Caddy's @import_chunk matches. Its route counts the bytes against the chunk's own
 * rules, so it is the one route besides POST /api/media that the JSON body limit leaves alone.
 */
const IMPORT_CHUNK_PATH = /^[/]api[/]imports[/][0-9a-f-]{36}[/]archive$/;
const isRawUpload = (method: string, path: string): boolean => (method === "POST" && path === "/api/media") || (method === "PUT" && IMPORT_CHUNK_PATH.test(path));

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
  /** 3d: the public figures' two routes. Optional as the other modules are; the server always wires it. */
  transparency?: Transparency;
  /** 3b: import from other platforms. Optional as the other modules are; the server always wires it. */
  imports?: Imports;
  /** 2d: Activity. Optional as the other modules are; the server always wires it. */
  activity?: Activity;
}

export function createApp({ config, logger, rateLimitStore, healthChecks, auth, social, media, account, staff, moderation, advisoryChecks, transparency, imports, activity }: AppDeps) {
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
  app.use((c, next) => (isRawUpload(c.req.method, c.req.path) ? next() : jsonBodies(c, next)));
  // Image files come before the global limit and session resolution: they have their own bucket,
  // and a public image needs no session. Everything else under /api/media falls through to below.
  if (media) app.route("/api/media", media.fileRoutes);
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIpKey }));
  // 3f (design, section 7.12): the status of a post's page, which Caddy asks for every view of /post/*, with the visitor's
  // cookies: after the global limit, which counts it against the visitor, and before the session's resolution, so it
  // reads no session. Every other path falls through to below.
  if (social) app.route("/api", social.statusRoutes);
  // 3d (design, sections 9.1 and 10.6): GET /api/public/facts and /api/public/transparency, at the same place and for the
  // same reasons: counted against the visitor by the global limit, and answered before any session is read. Each sets its
  // own Cache-Control, which noStore leaves alone.
  if (transparency) app.route("/api", transparency.routes);
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
  // 3b (design, section 9.1): every route behind the auth module's requireSession, CSRF included, like the social routes.
  if (imports) app.route("/api/imports", imports.routes);
  // 2d (design, section 9.2): every route behind the auth module's requireSession, CSRF included for the two writes.
  if (activity) app.route("/api/activity", activity.routes);
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
    // 3b (design, sections 9.1 and 9.4): every refusal of an import with its status, never 500; wrong_offset carries the
    // stored size, so the app goes on from there.
    if (err instanceof ImportError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId"), err.details), err.status);
    }
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // 2d: a cursor of Activity that names no place; the limits of its two writes are the social module's (above).
    if (err instanceof ActivityError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
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
