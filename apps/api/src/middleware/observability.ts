import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { Logger } from "pino";
import type { AppEnv } from "../env";

/** Request id (never client-supplied), child logger, and one access-log line per request. */
export function observability(logger: Logger) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    const log = logger.child({ requestId, cfRay: c.req.header("cf-ray") });
    c.set("requestId", requestId);
    c.set("log", log);
    await next();
    c.res.headers.set("x-request-id", requestId);
    log.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - start) },
      "request",
    );
  });
}
