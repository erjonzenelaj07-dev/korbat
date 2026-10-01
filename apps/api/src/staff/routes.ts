import { Hono } from "hono";
import type { AppEnv } from "../env";
import { staffGate } from "./gate";

/**
 * The staff routes (3a design, section 7), which createApp mounts at /api/staff only while CONSOLE_ORIGIN is set. The gate
 * stands in front of every path under it, /api/staff itself and the paths no route answers included, so a wrong Host is
 * the 404 of an unknown route there too. The routes themselves (sign-in, sessions, the audit log, step-up) come with the
 * auth module's staff flows.
 */
export function staffRoutes(consoleOrigin: string) {
  const routes = new Hono<AppEnv>();
  routes.use("*", staffGate(consoleOrigin));
  return routes;
}
