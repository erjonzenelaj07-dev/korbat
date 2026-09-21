import { Hono } from "hono";
import type { HealthResponse } from "@korbat/contracts";
import type { AppEnv } from "../env";

export type HealthChecks = Record<string, () => Promise<void>>;

/**
 * `checks` are what the API cannot work without: one failing answers 503. `advisory` checks report a
 * part that is down while the API still serves, the image worker for one: a failure there is
 * `degraded` with status 200, so container health and Caddy's start do not hang on it.
 */
export function healthRoutes(checks: HealthChecks, version: string, advisory: HealthChecks = {}) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries({ ...checks, ...advisory }).map(async ([name, fn]) => {
        try {
          await fn();
          return [name, "ok"] as const;
        } catch (err) {
          c.get("log").warn({ err, check: name }, "health check failed");
          return [name, "fail"] as const;
        }
      }),
    );
    const ok = entries.every(([, s]) => s === "ok");
    const critical = entries.every(([name, s]) => s === "ok" || name in advisory);
    const body: HealthResponse = { status: ok ? "ok" : "degraded", version, checks: Object.fromEntries(entries) };
    return c.json(body, critical ? 200 : 503);
  });
  return r;
}
