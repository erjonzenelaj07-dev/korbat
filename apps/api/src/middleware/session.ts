import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";

/**
 * Foundation stub: nobody is ever signed in. Sub-project 1 replaces this with
 * cookie (web) and bearer (native) session resolution against auth.sessions.
 * The requireSession contract stays the same.
 */
export const sessionStub = createMiddleware<AppEnv>(async (c, next) => {
  c.set("session", null);
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("session")) {
    return c.json(errorBody("unauthenticated", "Sign in required", c.get("requestId")), 401);
  }
  await next();
});
