/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { createSocialRepo, type AccountLockMode, type CapturedPost, type CapturedProfile } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { AccountLockMode, CapturedPost, CapturedProfile } from "./repo";
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

/**
 * What the moderation module needs from this one (3c design, section 5): the locks on profile rows that order a case's
 * transactions against everything else an account does, and the reads a case's evidence and its rules are built from.
 * The moderation module owns no table of this one and never writes to one.
 */
export interface SocialForModeration {
  /** Locks these profile rows in id order, in one statement; with `live`, a missing or deleted account is refused (not_found). */
  lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live?: boolean): Promise<{ id: string; deleted: boolean }[]>;
  /** The post, locked `for share`, as evidence copies it, or null; its body is empty when its content was erased. */
  capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null>;
  /** The account's handle, display name and bio as evidence copies them, or null. */
  captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null>;
  /**
   * The account a handle names. With `withDeleted`, for a report of child sexual abuse material, also a deleted profile
   * and the account of a handle it has left; without it, only a live profile that holds the handle now.
   */
  findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null>;
  /** Who wrote the post, or null when no row has the id. */
  postAuthor(postId: string): Promise<string | null>;
  /** The post's author, state and the post it quotes, or null when no row has the id; no lock. */
  postRef(postId: string): Promise<{ authorId: string; state: "visible" | "withheld" | "removed" | "deleted_by_author"; quoteOfId: string | null } | null>;
}

/**
 * The moderation module's interface over the social repository on the pool it is given. A factory of its own, not a
 * member of createSocial's result: the social module's views take facts from the moderation module, which is therefore
 * built between the two.
 */
export function socialForModeration(apiDb: Db): SocialForModeration {
  const repo = createSocialRepo(apiDb);
  return {
    lockAccounts: (tx, ids, mode, live) => repo.lockAccounts(tx, ids, mode, live),
    capturePost: (tx, postId) => repo.capturePost(tx, postId),
    captureProfile: (tx, accountId) => repo.captureProfile(tx, accountId),
    findAccountByHandle: (handle, withDeleted) => repo.findAccountByHandle(handle, withDeleted),
    postAuthor: (postId) => repo.postAuthor(postId),
    postRef: (postId) => repo.postRef(postId),
  };
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
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
