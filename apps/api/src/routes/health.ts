import { Hono } from "hono";
import type { HealthResponse } from "@korbat/contracts";
import type { AppEnv } from "../env";

export type HealthChecks = Record<string, () => Promise<void>>;

export function healthRoutes(checks: HealthChecks, version: string) {
  const r = new Hono<AppEnv>();
  r.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, fn]) => {
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
    const body: HealthResponse = { status: ok ? "ok" : "degraded", version, checks: Object.fromEntries(entries) };
    return c.json(body, ok ? 200 : 503);
  });
  return r;
}
