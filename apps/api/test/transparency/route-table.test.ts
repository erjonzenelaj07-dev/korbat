import type { MiddlewareHandler } from "hono";
import pino from "pino";
import { describe, expect, test } from "vitest";
import { RECIPIENT_READ_ROUTES } from "@korbat/contracts";
import { createDb } from "@korbat/db";
import type { AppEnv } from "../../src/env";
import { MemoryStore } from "../../src/middleware/rate-limit";
import { createSocial } from "../../src/social";

/**
 * The route table of the recipients' count (3d design, sections 7.5 and 10.1; Task 4): RECIPIENT_READ_ROUTES are exactly
 * the reads of the social module that answer without a session, so a signed-out read added later fails here until it is
 * listed there or refused below by name. The database pool is created and never connects: only the table is read.
 */
describe("RECIPIENT_READ_ROUTES and the social module's signed-out reads (3d Task 4)", () => {
  /** Signed-out reads that are deliberately not counted, each with why. */
  const NOT_COUNTED: Record<string, string> = {
    // Caddy asks it for every view of a post's page (3f): the page's own read is what a person makes.
    "GET /api/posts/:id/status": "the page status, which Caddy asks",
  };

  function signedOutReads(): string[] {
    const guard: MiddlewareHandler<AppEnv> = async (_c, next) => next();
    const fresh: MiddlewareHandler<AppEnv> = async (_c, next) => next();
    const social = createSocial({ apiDb: createDb("postgres://a:b@localhost:55432/k", { max: 1 }), rateLimitStore: new MemoryStore(), logger: pino({ level: "silent" }), requireSession: guard, requireFreshAuth: fresh });
    const chains = new Map<string, unknown[]>();
    for (const router of [social.routes, social.statusRoutes]) {
      for (const route of router.routes) {
        if (route.method !== "GET") continue;
        const key = `GET /api${route.path}`;
        chains.set(key, [...(chains.get(key) ?? []), route.handler]);
      }
    }
    return [...chains.entries()].filter(([, handlers]) => !handlers.includes(guard)).map(([key]) => key);
  }

  test("every GET of the social module without the session guard is a counted read or refused by name, and every counted read is one", () => {
    const reads = signedOutReads();
    const counted = reads.filter((route) => !(route in NOT_COUNTED));
    expect(counted.sort()).toEqual([...RECIPIENT_READ_ROUTES].sort());
    for (const route of Object.keys(NOT_COUNTED)) expect(reads).toContain(route);
  });

  test("the check reads the guard: a guarded read such as the Following timeline is no signed-out read", () => {
    const reads = signedOutReads();
    expect(reads).not.toContain("GET /api/timeline/following");
    expect(reads).not.toContain("GET /api/me/likes");
    expect(reads).toContain("GET /api/timeline/latest");
  });
});
