/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, for the
   * media rows. Safe to repeat: a second run changes nothing.
   */
  purgeProfile(userId: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void>;
  /**
   * The profile, read at once, and its posts with their images, its engagement and its side of the graph,
   * each read in keyset pages of `pageSize` rows (1,000 unless a test says otherwise) as it is iterated.
   */
  exportProfile(userId: string, pageSize?: number): Promise<ProfileExport>;
}

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's requireFreshAuth: a credential proven in the last five minutes, which a handle change needs on top. */
  requireFreshAuth: MiddlewareHandler<AppEnv>;
  /** The auth module's appendEvent, so profile and handle changes land in auth_events. Without it nothing is recorded (the 2a tests). */
  events?: SocialEvents;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
  };
}

export type Social = ReturnType<typeof createSocial>;
