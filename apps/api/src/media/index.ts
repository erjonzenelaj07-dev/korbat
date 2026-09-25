/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db, DbTx } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles, type StoredFile } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";
export type { StoredFile } from "./files";
export type { SweepReport } from "./sweeper";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account's images, and the data export. */
export interface MediaForAccount {
  /** Removes every image row of the owner, on a post or not, whatever its state, inside the account purge's transaction; the ids name the files to delete. */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /**
   * Asks the worker to delete the files of these images, whatever their state: an upload still waiting
   * in the uploads volume is removed first, as the sweeper removes one it gives up on, so no worker picks
   * it up after the account is gone (removing is idempotent, and costs nothing for an image whose upload
   * was taken already); then one empty request file per id, so asking twice is asking once. The account
   * purge asks inside its transaction, right after purgeOwner, so the requests are on disk before the rows
   * are gone for good.
   */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /**
   * The account's ready images, on a post or not, each with the checked open of its large variant: the
   * store is written by the worker and not trusted, so a file is read only when it is a plain file of the
   * store's own device no larger than a variant may be, and only up to the size that check measured
   * (null, and the export lists the image as missing, otherwise).
   */
  exportImages(ownerId: string): Promise<{ id: string; open(): Promise<StoredFile | null> }[]>;
}

/** The account module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForAccount(deps: MediaDeps): MediaForAccount {
  return {
    purgeOwner: (tx, ownerId) => deps.repo.purgeOwner(tx, ownerId),
    async requestDeletion(ids) {
      for (const id of ids) await deps.files.discardUpload(id);
      await deps.files.requestDeletion(ids);
    },
    exportImages: async (ownerId) => (await deps.repo.readyImages(ownerId)).map((id) => ({ id, open: () => deps.files.openImage(id, "large") })),
  };
}

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  /** See MEDIA_RECONCILE; defaults to `on`. */
  reconcile?: "on" | "off" | "force";
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    reconcileMode: options.reconcile ?? "on",
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  const forAccount = mediaForAccount(deps);
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** The interface the account module uses. */
    forAccount,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the shared job lock, and returns the function that stops it. */
    startSweeper: (lock: JobLock) => createSweeper(deps, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
