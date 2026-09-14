import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Logger } from "pino";
import type { Config } from "./config";
import type { AppEnv } from "./env";
import { errorBody } from "./lib/errors";
import { observability } from "./middleware/observability";
import { clientIp, rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { noStore, securityHeaders } from "./middleware/security-headers";
import { requireSession, sessionStub } from "./middleware/session";
import { healthRoutes, type HealthChecks } from "./routes/health";

export interface AppDeps {
  config: Config;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  healthChecks: HealthChecks;
}

export function createApp({ config, logger, rateLimitStore, healthChecks }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(observability(logger));
  app.use(securityHeaders, noStore);
  app.use(cors({ origin: config.TRUSTED_ORIGINS, credentials: true }));
  app.use(rateLimit({ name: "global", store: rateLimitStore, limit: 300, windowMs: 60_000, key: clientIp }));
  app.use(sessionStub);

  app.route("/api/health", healthRoutes(healthChecks, config.KORBAT_VERSION));
  app.get("/api/me", requireSession, (c) => c.json({ session: c.get("session") }));

  app.notFound((c) => c.json(errorBody("not_found", "No such route", c.get("requestId")), 404));
  app.onError((err, c) => {
    c.get("log").error({ err }, "unhandled error");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  return app;
}
