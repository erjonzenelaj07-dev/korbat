/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { MEDIA_SIZES } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import { mediaForCases } from "./cases";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles, storedImageName, type StoredFile } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { DISPOSAL_BATCH, mediaForCases } from "./cases";
export type { MediaForCases, StaffImage } from "./cases";
export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts, PostImage } from "./context";
export type { StoredFile } from "./files";
export type { CaseReach, HeldImage, HoldPair } from "./repo";
export type { SweepReport } from "./sweeper";

/** One attached image row as text-verify reads it: its id, its post, its stored moderation state and when its content was erased. */
export interface ImageModerationState {
  id: string;
  postId: string;
  moderationState: "visible" | "withheld" | "removed" | "sealed";
  erasedAt: Date | null;
}

/**
 * Up to `limit` image rows that are on a post and whose id is greater than `afterId` (from the start when it is null),
 * in id order (3c design, section 5). Built on the media repository over the pool it is given, with no files and no
 * configuration: its only caller is `staff.js text-verify`, which opens database URLs alone and, like every file outside
 * this module, may not name the image table itself.
 */
export function imageModerationStates(apiDb: Db, afterId: string | null, limit: number): Promise<ImageModerationState[]> {
  return createMediaRepo(apiDb).moderationStates(afterId, limit);
}

/**
 * 3f (design, sections 5 and 7.4): the post an image's address belongs to, or null when no image row on a post has the
 * id. Read through the caller's own connection or transaction, with no files and no configuration: opening an order, in
 * the console's route and in `staff.js order-open`, takes an image's link as its post, and no file outside this module may
 * name the image table.
 */
export function imagePost(q: Db | DbTx, mediaId: string): Promise<string | null> {
  return createMediaRepo(q as Db).imagePost(q, mediaId);
}

/**
 * 3f (design, section 7.5): how many image rows each of these posts holds, for an order's screen, which counts a post's
 * images and never shows one. Read through the caller's own connection or transaction.
 */
export function imageCounts(q: Db | DbTx, postIds: readonly string[]): Promise<Map<string, number>> {
  return createMediaRepo(q as Db).imageCounts(q, postIds);
}

/** One image row of a preserved post as staff.js order-access prints it: never a file, and no digest, which the table does not hold. */
export interface PreservedImage {
  id: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

/**
 * 3f (design, sections 5 and 7.11): the image rows of a post that an order preserves, for `staff.js order-access`, which
 * prints their ids, pixel sizes and creation times and records the access. Read-only, through the caller's own
 * transaction, with no files and no configuration: no file outside this module may name the image table.
 */
export function preservedImages(q: Db | DbTx, postId: string): Promise<PreservedImage[]> {
  return createMediaRepo(q as Db).preservedImages(q, postId);
}

/** One post of a seal as staff.js handover-list reads it: its image rows now, and the store's name of every size of each. */
export interface SealFilesPost {
  postId: string;
  /** How many image rows the post holds now, which the command compares with the seal's own count. */
  rows: number;
  names: string[];
}

/**
 * 3f (design, sections 5 and 7.14): for each post of one seal (its seal_posts), the store's names of every stored size of
 * every image row of the post, and the number of rows, for `staff.js handover-list`, which compares that number with
 * seal_posts.images itself. Read-only, through the caller's own transaction, with no files and no configuration: no
 * file outside this module may name the image table, and the hand-over's program, which reads the files, has no database.
 */
export async function sealFiles(q: Db | DbTx, sealActionId: string): Promise<SealFilesPost[]> {
  const posts = await createMediaRepo(q as Db).sealImageRows(q, sealActionId);
  return posts.map(({ postId, mediaIds }) => ({ postId, rows: mediaIds.length, names: mediaIds.flatMap((id) => MEDIA_SIZES.map((size) => storedImageName(id, size))) }));
}

export { storedImageName } from "./files";

/** What the account module needs from this one (1b design, section 5): the purge of a deleted account's images, and the data export. */
export interface MediaForAccount {
  /**
   * Removes the owner's image rows, on a post or not, whatever their state, inside the account purge's transaction; the
   * ids name the files to delete. A row that a case holds, and every row of a frozen post, stays and is not answered
   * (3c design, section 7.10): the purge asks for the files of the rows it was answered, and of no other. Still inside
   * that transaction it notes that those files are owed a request, so the rows cannot be gone for good without a record
   * from which the request is written; where the note cannot be written this throws, and the purge's transaction fails.
   */
  purgeOwner(tx: DbTx, ownerId: string): Promise<string[]>;
  /**
   * Asks the worker to delete the files of these images, whatever their state: an upload still waiting
   * in the uploads volume is removed first, as the sweeper removes one it gives up on, so no worker picks
   * it up after the account is gone (removing is idempotent, and costs nothing for an image whose upload
   * was taken already); then one empty request file per id, so asking twice is asking once; then what was
   * owed for them is settled. The account purge asks only after its transaction has committed, for the rows
   * that transaction deleted: a request cannot be taken back, and rows that a failed commit put back may be
   * frozen by a report before the purge runs again. When it throws, the deletion stays owed, and the sweeper
   * asks again at its next pass.
   */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /**
   * The account's ready images that it is still shown, on a post or not, each with the checked open of its large
   * variant: the store is written by the worker and not trusted, so a file is read only when it is a plain file of the
   * store's own device no larger than a variant may be, and only up to the size that check measured
   * (null, and the export lists the image as missing, otherwise). A sealed image, an image of a deleted post and an
   * erased one are not listed; `open` reads the row again and answers null for an image that has become one of those
   * since the list was read, so a seal that commits while an archive streams leaves no sealed file in it from then on.
   */
  exportImages(ownerId: string): Promise<{ id: string; open(): Promise<StoredFile | null> }[]>;
}

/** The account module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForAccount(deps: MediaDeps): MediaForAccount {
  return {
    async purgeOwner(tx, ownerId) {
      const ids = await deps.repo.purgeOwner(tx, ownerId);
      await deps.files.oweDeletion(ids);
      return ids;
    },
    async requestDeletion(ids) {
      for (const id of ids) await deps.files.discardUpload(id);
      await deps.files.requestDeletion(ids);
      await deps.files.settleOwed(ids);
    },
    exportImages: async (ownerId) =>
      (await deps.repo.readyImages(ownerId)).map((id) => ({
        id,
        // The row is read again, with the list's own condition, right before the file is opened.
        open: async () => ((await deps.repo.isExportable(ownerId, id)) ? deps.files.openImage(id, "large") : null),
      })),
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
  const forCases = mediaForCases(deps);
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the moderation module uses: an intake's holds, what a case reaches, the staff's image, the disposal. */
    forCases,
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
