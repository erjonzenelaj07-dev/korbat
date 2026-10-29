/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { Author, PostView, ProfileView } from "@korbat/contracts";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import type { AppEnv } from "../env";
import type { JobLock } from "../lib/jobs";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { ModerationForSocial } from "../moderation";
import { WITHOUT_MEDIA, type SocialDeps, type SocialEvents } from "./context";
import type { StoredPostState } from "./visibility";
import { startExplore } from "./explore";
import { exportProfile, type ProfileExport } from "./flows/export";
import { profileViewOf } from "./flows/profiles";
import { publishImportedBatch, removeImportedBatch } from "./flows/imports";
import { createSocialRepo, type AccountLockMode, type CapturedPost, type CapturedProfile, type ImportBatchJob, type ImportBatchPost, type ImportBatchResult, type LockedAccount } from "./repo";
import { postStatusRoutes, socialRoutes } from "./routes";
import { authorOf, isTombstone, loadPostViews, postView } from "./views";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
// 3b (design, section 7.6): the imports module counts its chunks, acts and picks in this module's one table of limits.
export { limitsFor } from "./tiers";
export type { EngagementAction, ImportAction, WriteAction } from "./tiers";
export type { SocialDeps, SocialEvents, ViewerId } from "./context";
export type { AccountLockMode, CapturedPost, CapturedProfile, ImportBatchJob, ImportBatchPost, ImportBatchResult, LockedAccount } from "./repo";
export type { ExportedMedia, ExportedPost, ProfileExport } from "./flows/export";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account, and the data export. */
export interface SocialForAccount {
  /**
   * One transaction that tombstones every post, removes the engagement and graph rows with their
   * counters and anonymises the profile row, keeping its handle; `within` runs inside it, as its last
   * act, for the media rows. Safe to repeat: a second run changes nothing.
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
  /**
   * Locks these profile rows in id order, in one statement; with `live`, a missing or deleted account is refused
   * (not_found). Each row answers whether its account is deleted and (3e) whether it is suspended and restricted in its
   * reports, read in the locking statement by the clock.
   */
  lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live?: boolean): Promise<LockedAccount[]>;
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
  postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null>;
}

/**
 * What the imports module needs from this one (3b design, section 9.1): the read of 7.5 step 2 that tells which lines of
 * an archive the account already imported, and (Task 6) the batch writers of section 6.5.
 */
export interface SocialForImports {
  /** Which of these keys (64 lowercase hex each) the account's posts that still exist carry; at most a thousand a call. */
  importedKeys(ownerId: string, keys: readonly string[]): Promise<Set<string>>;
  /**
   * One batch of an import's posts in one transaction judged by 3e's predicate: { written: false } when the import is no
   * longer publishing at the cursor given; a suspended author's batch throws account_suspended and writes nothing.
   */
  publishImportedBatch(job: ImportBatchJob, batch: { lines: number; posts: readonly ImportBatchPost[] }, now: Date): Promise<ImportBatchResult>;
  /** One batch of an import's undo, at most `limit` posts, their image files asked for after the commit; selected 0 when none is left. */
  removeImportedBatch(job: { id: string; ownerId: string }, now: Date, limit: number): Promise<{ selected: number; removed: number }>;
}

/**
 * What the activity module needs from this one (2d design, sections 5.5 and 9.1): the views of an Activity page's posts
 * and of a follow group's accounts, built here so that whatever a view or an Author carries (Task 3's avatar) lands in one
 * place. Its limits it counts through enforceWriteLimit, which this file exports.
 */
export interface SocialForActivity {
  /**
   * Views of these posts for the reader through loadPostViews, so each passes postAccess as every read of a post does:
   * only the posts the reader is shown are in the answer, each with its mentions and its counts as this reader gets them.
   */
  postViews(viewer: string, postIds: readonly string[]): Promise<Map<string, PostView>>;
  /** These accounts as an Author, by id; an id with no profile row is not in the answer. */
  authors(ids: readonly string[]): Promise<Map<string, Author>>;
}

/**
 * What the cards module needs from this one (2d design, sections 8.1 and 8.4): a post or a profile exactly as a signed-out
 * reader gets it, from the same reads GET /api/posts/:id and GET /api/profiles/:handle make with no viewer, so moderation,
 * deletion and 3f's disabled follow without a rule of the card's own; and with each the owner's link-preview switch, which no
 * public read carries.
 */
export interface SocialForCards {
  /**
   * The post through postView with no viewer, so postAccess decides it as for anyone signed out: only a visible post, with
   * its images as a signed-out reader gets them; null for any other state, a missing post, or an author deleted meanwhile.
   */
  post(postId: string): Promise<{ view: PostView; previews: boolean } | null>;
  /** The live profile that holds this handle now, lowercased (an old handle names none), with no viewer; null when none. */
  profile(handle: string): Promise<{ view: ProfileView; previews: boolean } | null>;
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
  /** The moderation module's interface for views: moderation.forSocial. Without it no post carries the author's chip. */
  moderation?: ModerationForSocial;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    moderation: options.moderation,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
    events: options.events,
  };
  const forAccount: SocialForAccount = {
    purgeProfile: (userId, now, within) => deps.repo.purgeProfile(userId, now, within),
    exportProfile: (userId, pageSize) => exportProfile(deps, userId, pageSize),
  };
  const forActivity: SocialForActivity = {
    async postViews(viewer, postIds) {
      const loaded = await loadPostViews(deps, viewer, [...postIds]);
      return new Map([...loaded].flatMap(([id, view]) => (isTombstone(view) ? [] : [[id, view] as const])));
    },
    async authors(ids) {
      // 2d Task 3 (7.5): the follow groups' actors with their avatars, from one avatarsOf; as any reader but the actor sees them.
      const [found, avatars] = await Promise.all([deps.repo.findProfiles([...ids]), deps.media.avatarsOf([...ids], null)]);
      return new Map([...found].map(([id, profile]) => [id, authorOf(profile, avatars.get(id) ?? null)] as const));
    },
  };
  const forCards: SocialForCards = {
    async post(postId) {
      const view = await postView(deps, null, postId);
      if (view === null) return null;
      const previews = (await deps.repo.sharePreviewsOf([view.author.id])).get(view.author.id);
      return previews === undefined ? null : { view, previews };
    },
    async profile(handle) {
      const row = await deps.repo.findProfileByHandle(handle);
      if (row === null) return null;
      const [view, switches] = await Promise.all([profileViewOf(deps, null, row), deps.repo.sharePreviewsOf([row.id])]);
      const previews = switches.get(row.id);
      return previews === undefined ? null : { view, previews };
    },
  };
  const forImports: SocialForImports = {
    importedKeys: (ownerId, keys) => deps.repo.importedKeys(ownerId, keys),
    publishImportedBatch: (job, batch, now) => publishImportedBatch(deps, job, batch, now),
    removeImportedBatch: (job, now, limit) => removeImportedBatch(deps, job, now, limit),
  };
  return {
    deps,
    /** The interface the account module uses. */
    forAccount,
    /** 3b: the interface the imports module uses. */
    forImports,
    /** 2d: the interface the activity module uses. */
    forActivity,
    /** 2d Task 6: the interface the cards module uses. */
    forCards,
    routes: socialRoutes(deps, options.requireSession, options.requireFreshAuth),
    /**
     * 3f (design, section 7.12): GET /api/posts/:id/status, a router of its own that app.ts mounts after the global limit
     * and before the session's resolution. No interface member: nothing outside this module calls it.
     */
    statusRoutes: postStatusRoutes(deps),
    /**
     * Starts the Explore refresh under the shared job lock: a round at once, then one every five minutes. Returns the
     * function that stops the timer.
     */
    startExplore: (lock: JobLock) => startExplore(deps, lock),
  };
}

export type Social = ReturnType<typeof createSocial>;
