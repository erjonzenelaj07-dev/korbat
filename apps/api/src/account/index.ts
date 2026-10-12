/**
 * The only file outside `src/account/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AuthForAccount } from "../auth";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForAccount } from "../media";
import type { ModerationForAccount } from "../moderation";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialForAccount } from "../social";
import type { AccountDeps } from "./context";
import { createPurgeJob } from "./purge";
import { accountRoutes } from "./routes";

export { AccountError } from "./context";
export type { AccountDeps } from "./context";

export interface CreateAccountOptions {
  /** The other modules' interfaces for this one, as their index files hand them out: auth.forAccount, social.forAccount, media.forAccount. */
  auth: AuthForAccount;
  social: SocialForAccount;
  media: MediaForAccount;
  /** The moderation module's interface for this one: moderation.forAccount. Without it the purge forgets no report's sender, and the export's moderation member is empty. */
  moderation?: ModerationForAccount;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which the export needs. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's requireStrongFreshAuth: level 2 on an account with TOTP, which starting and confirming a deletion need (1c design, section 10). */
  requireStrongFreshAuth: MiddlewareHandler<AppEnv>;
  /** The daily export limit shares the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  now?: () => Date;
}

export function createAccount(options: CreateAccountOptions) {
  const deps: AccountDeps = {
    auth: options.auth,
    social: options.social,
    media: options.media,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return {
    deps,
    routes: accountRoutes(deps, options.requireSession, options.requireFreshAuth, options.requireStrongFreshAuth),
    /** Starts the purge job (deletions left half done, every five minutes under the shared lock) and returns the function that stops it. */
    startPurge: (lock: JobLock) => createPurgeJob(deps, lock).start(),
  };
}

export type Account = ReturnType<typeof createAccount>;
