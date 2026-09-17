/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialDeps } from "./context";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export type { SocialDeps, ViewerId } from "./context";

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return { deps, routes: socialRoutes(deps, options.requireSession) };
}

export type Social = ReturnType<typeof createSocial>;
