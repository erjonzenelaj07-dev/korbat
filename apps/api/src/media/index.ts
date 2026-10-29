/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { MEDIA_SIZES, type QuarantineDirection } from "@korbat/contracts";
import { sql } from "drizzle-orm";
import type { Db, DbTx } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import { mediaForCases } from "./cases";
import type { MediaDeps, MediaForPosts } from "./context";
import { createEdgeJob } from "./edge";
import { edgeAdapterFrom, type EdgeAdapter } from "./edge-adapter";
import { createMediaFiles, storedImageName, type StoredFile } from "./files";
import { finalize } from "./flows/status";
import { receiveImported, type ImportedReceipt } from "./flows/upload";
import { createMatchRetryJob, matchRetryRound } from "./match";
import { matchAdapterFrom, type MatchAdapter } from "./match-adapter";
import { createMatchRepo } from "./match-repo";
import { createMediaRepo, type ImportImageRow } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";
import type { JobLock } from "../lib/jobs";
import { createSweeper, sweep } from "./sweeper";

export { DISPOSAL_BATCH, mediaForCases } from "./cases";
export type { ImageSignals, LostImage, MediaForCases, StaffImage, UnsignalledImage } from "./cases";
export { MediaError } from "./context";
export type { MatchEvent, MatchHandler, MediaDeps, MediaForPosts, PostImage } from "./context";
// 3d Task 7: the comparison's adapter, which the wiring builds from the configuration (MEDIA_MATCH), and what its rows read.
export { MATCH_ACTING, MATCH_LISTED, matchAdapterFrom, matchRequest } from "./match-adapter";
export type { MatchAdapter, MatchAnswer, MatchRequest, TestMatchAdapter, UploadHashes } from "./match-adapter";
export type { MatchRetryReport } from "./match";
export type { OwnRefusal, RefusalRow } from "./match-repo";
export type { StoredFile } from "./files";
export type { CaseReach, HeldImage, HoldPair, ImportImageRow } from "./repo";
export type { ImportedReceipt } from "./flows/upload";
export type { SweepReport } from "./sweeper";
// 3d Task 3: the edge's purge adapter, which the wiring builds from the configuration (EDGE_PURGE and its settings).
export { edgeAdapterFrom } from "./edge-adapter";
export type { EdgeAdapter, EdgeSettings } from "./edge-adapter";
export type { EdgeRoundReport } from "./edge";

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

/** One image of the quarantine's plan as staff.js quarantine-list prints it: its direction, its post, and the files to name. */
export interface QuarantineLine {
  direction: QuarantineDirection;
  mediaId: string;
  /** The image's post, or for an image row that is gone the post its quarantine rows recorded; null for neither. */
  postId: string | null;
  /** The store's names of the files the line is about, one line of the list each. */
  files: string[];
}

/** A post sealed for good whose image rows now are not as many as a seal of it recorded. */
export interface QuarantineMismatch {
  postId: string;
  rows: number;
  images: number[];
}

/**
 * 3d (design, sections 5, 6.1, 7.1 and 8.10): the quarantine's plan joined to the store's naming rule, for staff.js
 * quarantine-list, through the caller's transaction, which reads as the migrator: quarantine_plan() is executable by
 * nobody else, and the command line cannot build the module (F 5), nor may any file outside it name the image table.
 *
 * An image to move in names each of its files that is not in the quarantine already (a lost file counts as there: nothing
 * of it is left to move); an image to return, to destroy or for the operator names each of its files whose row has no end.
 * For every post sealed for good, its image rows now, erased or not, are compared with the count each of its seals
 * recorded (seal_posts.images): a post whose rows differ gets no line and is answered among `mismatched`, so the command
 * names it and still prints every other post's lines. A list that missed a row would leave a sealed file in the store.
 */
export async function quarantineNames(q: Db | DbTx): Promise<{ lines: QuarantineLine[]; mismatched: QuarantineMismatch[] }> {
  const repo = createMediaRepo(q as Db);
  const mismatched = (await repo.sealedForGoodCounts(q)).filter((post) => post.images.some((images) => images !== post.rows));
  const left = new Set(mismatched.map((post) => post.postId));
  const lines: QuarantineLine[] = [];
  for (const image of await repo.quarantinePlan(q)) {
    if (image.postId !== null && left.has(image.postId)) continue;
    const names = MEDIA_SIZES.map((size) => storedImageName(image.mediaId, size));
    const files = image.direction === "in" ? names.filter((name) => !image.kept.includes(name)) : names.filter((name) => image.open.includes(name));
    if (files.length > 0) lines.push({ direction: image.direction as QuarantineDirection, mediaId: image.mediaId, postId: image.postId, files });
  }
  return { lines, mismatched };
}

/**
 * 3d Task 2 (design, sections 5 and 8.10): text-verify's two reads of the release, plain functions that take the caller's
 * transaction, as quarantineNames does, since no file outside this module names the image table. quarantineOrphans
 * reads quarantine_files, which only the migrator reads: a file in the quarantine without an image row and without a
 * release. releasedUnerased reads on any role: a released post that still has an image row without erased_at.
 */
export function quarantineOrphans(q: Db | DbTx): Promise<{ mediaId: string; postId: string | null }[]> {
  return createMediaRepo(q as Db).quarantineOrphans(q);
}
export function releasedUnerased(q: Db | DbTx): Promise<{ postId: string; images: number }[]> {
  return createMediaRepo(q as Db).releasedUnerased(q);
}

/**
 * 3d Task 7 (design, sections 7.10 and 10.2): a match record as a statement reads it (its source, hash type, kind and
 * whether it is listed), through the caller's own connection or transaction, as imagePost reads: the statement of a
 * decision is built over a pool alone, and no file outside this module may name the records' table. Null when none.
 */
export async function matchRecordOf(q: Db | DbTx, matchId: string): Promise<{ source: string; hashType: "sha256" | "sha1" | "md5" | "pdq"; matchKind: "exact" | "near"; listed: boolean } | null> {
  const record = await createMatchRepo(q as Db).record(q, matchId);
  return record === null ? null : { source: record.source, hashType: record.hashType, matchKind: record.matchKind, listed: record.listed };
}

/**
 * 3d Task 7 (design, section 8.10, automation-status): the comparison's counts, through the caller's own connection or
 * transaction: the uploads whose check is unchecked and since when the oldest is (within the retry's hours), and the
 * refusals written in the last hour, which the limit on refusals counts. Counts and one time, never an image.
 */
export async function matchStatus(q: Db | DbTx): Promise<{ unchecked: number; oldestUnchecked: string | null; refusalsHour: number }> {
  const [row] = (await q.execute(sql`
    select (select count(*)::int from public.media_hashes h join public.post_media m on m.id = h.media_id
             where h.check_state = 'unchecked' and m.created_at > now() - make_interval(hours => r.match_retry_hours)) as unchecked,
           (select to_char(min(m.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from public.media_hashes h join public.post_media m on m.id = h.media_id
             where h.check_state = 'unchecked' and m.created_at > now() - make_interval(hours => r.match_retry_hours)) as oldest,
           (select count(*)::int from public.upload_refusals u where u.refused_at > now() - make_interval(hours => 1)) as refusals_hour
      from public.automation_rules() r`)) as unknown as { unchecked: number; oldest: string | null; refusals_hour: number }[];
  return { unchecked: row!.unchecked, oldestUnchecked: row!.oldest, refusalsHour: row!.refusals_hour };
}

/**
 * 3d review L3: automation-status's count of the uploads of the last 24 hours that are ready without a score: while the R1
 * check is on, the worker scores every ready image, so each is one it did not score. Through the caller's transaction.
 */
export async function unscoredCount(q: Db | DbTx): Promise<number> {
  const [row] = (await q.execute(sql`
    select count(*)::int as n from public.post_media m
     where m.status = 'ready' and m.nsfw_score is null and m.created_at > now() - make_interval(hours => 24)`)) as unknown as { n: number }[];
  return row!.n;
}

/**
 * 3d review M6: a held upload's image by its refusal, and the release of the refusal that names an image, as the command
 * line reads them through the caller's transaction and without a lock (release-show reads in a read-only transaction):
 * release-show's files of a held upload's release, and the release a destroyed line's record names for a file on no
 * post. Null when no refusal answers.
 */
export async function refusalImage(q: Db | DbTx, refusalId: string): Promise<string | null> {
  const [row] = (await q.execute(sql`select u.media_id from public.upload_refusals u where u.id = ${refusalId}::uuid`)) as unknown as { media_id: string }[];
  return row?.media_id ?? null;
}
export async function refusalReleaseOfImage(q: Db | DbTx, mediaId: string): Promise<string | null> {
  const [row] = (await q.execute(sql`select u.release_id from public.upload_refusals u where u.media_id = ${mediaId}::uuid and u.release_id is not null`)) as unknown as { release_id: string }[];
  return row?.release_id ?? null;
}

/** 3d Task 7: a held upload as the command line reads it, through the caller's transaction (staff.js upload-report and release-leave). */
export interface CliRefusal {
  id: string;
  mediaId: string;
  ownerId: string | null;
  ownerDeleted: boolean;
  refusedAt: Date;
  endAs: "report" | "no_report" | null;
  notificationId: string | null;
  releaseId: string | null;
}

/**
 * 3d Task 7 (design, sections 5 and 8.10): one refusal, locked FOR UPDATE, for staff.js upload-report and release-leave,
 * which run as the migrator and cannot build the module; no file outside it may name the refusals' table. Null when there
 * is none.
 */
export async function refusalForCli(tx: DbTx, refusalId: string): Promise<CliRefusal | null> {
  const [row] = (await tx.execute(sql`
    select u.id, u.media_id, u.owner_id, exists (select 1 from public.profiles p where p.id = u.owner_id and p.deleted_at is not null) as owner_deleted,
           u.refused_at, u.end_as, u.notification_id, u.release_id
      from public.upload_refusals u where u.id = ${refusalId}::uuid for update`)) as unknown as {
    id: string;
    media_id: string;
    owner_id: string | null;
    owner_deleted: boolean;
    refused_at: Date | string;
    end_as: "report" | "no_report" | null;
    notification_id: string | null;
    release_id: string | null;
  }[];
  if (!row) return null;
  return { id: row.id, mediaId: row.media_id, ownerId: row.owner_id, ownerDeleted: row.owner_deleted, refusedAt: new Date(row.refused_at), endAs: row.end_as, notificationId: row.notification_id, releaseId: row.release_id };
}

/**
 * 3d Task 7 (design, sections 5, 7.12 step 4 and 8.10): staff.js upload-report's write, as the migrator: the id of 3f's
 * record of the report opened for the refusal, set once. Answers whether it was set.
 */
export async function refusalReported(tx: DbTx, refusalId: string, notificationId: string): Promise<boolean> {
  const rows = await tx.execute(sql`update public.upload_refusals set notification_id = ${notificationId}::uuid where id = ${refusalId}::uuid and notification_id is null returning id`);
  return rows.length === 1;
}

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
  /**
   * 2d Task 3 (design, sections 7.8 and 11.2): the account's picture as the export's profile names it, its id and size,
   * while it is set and the account is shown it; null otherwise. Its file is one of exportImages', the 400 px square.
   */
  exportAvatar(ownerId: string): Promise<{ id: string; width: number; height: number } | null>;
}

/**
 * The social module's interface over this module's dependencies, as createMedia hands it out; the integration tests build
 * it the same way. 2d Task 3: a former avatar's deletion after setAvatar's or removeAvatar's commit (7.3 step 6) asks for its
 * files only when its row went: an upload still in incoming/ is removed first, as the sweeper removes one it gives up on.
 */
export function mediaForPosts(deps: MediaDeps): MediaForPosts {
  return {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
    attachAvatar: (tx, accountId, mediaId) => deps.repo.attachAvatar(tx, accountId, mediaId),
    detachAvatar: (tx, accountId) => deps.repo.detachAvatar(tx, accountId),
    async dropFormerAvatar(id) {
      if (id === null || !(await deps.repo.deleteFormerAvatar(id))) return;
      await deps.files.discardUpload(id);
      await deps.files.requestDeletion([id]);
    },
    avatarsOf: (profileIds, viewer) => deps.repo.avatarsOf(profileIds, viewer),
  };
}

/** The account module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForAccount(deps: MediaDeps): MediaForAccount {
  return {
    exportAvatar: (ownerId) => deps.repo.exportAvatar(ownerId),
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

/**
 * What the imports module needs from this one (3b design, sections 6.5, 7.4, 8.1 and 8.2): the feeder's three conditions,
 * one image's way in through this module's own receive path, the settling of the import's images, the deletion of its
 * rows on no post and of their files, and the refusal its view links to. The imports module names neither post_media,
 * media_hashes, upload_refusals nor the request to delete a file: it reaches each through here.
 */
export interface MediaForImports {
  /** The comparison with known material is on (MEDIA_MATCH): images are imported only then (decision 15). */
  readonly matching: boolean;
  /** An upload that is no imported image's waits in incoming/ for the worker (7.4 step 1): a person's own goes first. */
  ownUploadWaiting(): Promise<boolean>;
  /** The imported images on the site that are processing without a result yet (7.4 step 2). */
  importedInFlight(): Promise<number>;
  /** Whether the volumes have the free space any upload needs (MEDIA_MIN_FREE_BYTES). */
  hasRoom(): Promise<boolean>;
  /** One image of the import in, from its work file (receiveImported). The caller closes the file's handle. */
  receive(input: Parameters<typeof receiveImported>[1]): Promise<ImportedReceipt>;
  /**
   * The import's rows on no post after its images still processing were finalized here (the sweeper's own step, so a
   * verdict the worker wrote is read within the round, with the check of known material and a refusal's notice).
   */
  settleRows(jobId: string): Promise<ImportImageRow[]>;
  /**
   * The import's rows on no post as they stand, finalizing nothing: Task 6's attach takes the kept ones (status ready,
   * check clear) for the posts of their lines.
   */
  importRows(jobId: string): Promise<ImportImageRow[]>;
  /**
   * Deletes the import's rows on no post, or these of them, in the caller's transaction (the keep trigger leaves a held
   * one), and notes there that their files are owed a request, as the account's purge does; answers the ids that went.
   */
  deleteImportLeftovers(tx: DbTx, jobId: string, ids?: readonly string[]): Promise<string[]>;
  /** After that transaction's commit: their uploads removed, their files' deletion asked of the worker, the notes settled. */
  releaseFiles(ids: readonly string[]): Promise<void>;
  /** The imports that still have rows on no post that no hold keeps. */
  importsWithLeftovers(): Promise<string[]>;
  /** The refusal of one of the import's images, the earliest; null when none. */
  refusalOf(jobId: string): Promise<string | null>;
}

/** The imports module's interface over this module's dependencies, as createMedia hands it out; the integration tests build it the same way. */
export function mediaForImports(deps: MediaDeps): MediaForImports {
  return {
    matching: deps.match.mode !== "off",
    async ownUploadWaiting() {
      const waiting = await deps.files.waitingUploads();
      const imported = await deps.repo.importedAmong(waiting);
      return waiting.some((id) => !imported.has(id));
    },
    async importedInFlight() {
      let count = 0;
      for (const id of await deps.repo.importedProcessing()) if (!(await deps.files.hasResult(id))) count++;
      return count;
    },
    hasRoom: async () => (await deps.files.freeBytes()) >= deps.minFreeBytes,
    receive: (input) => receiveImported(deps, input),
    async settleRows(jobId) {
      const before = await deps.repo.importRows(jobId);
      const capped = await deps.matches.capped(before.filter((row) => row.status === "processing").map((row) => row.id));
      // A capped upload waits for match-retry, which asks the source again; finalizing it here would ask every round.
      for (const row of before) if (row.status === "processing" && !capped.has(row.id)) await finalize(deps, row.id);
      return deps.repo.importRows(jobId);
    },
    importRows: (jobId) => deps.repo.importRows(jobId),
    async deleteImportLeftovers(tx, jobId, ids) {
      const gone = await deps.repo.deleteImportLeftovers(tx, jobId, ids);
      await deps.files.oweDeletion(gone);
      return gone;
    },
    async releaseFiles(ids) {
      for (const id of ids) await deps.files.discardUpload(id);
      await deps.files.requestDeletion(ids);
      await deps.files.settleOwed(ids);
    },
    importsWithLeftovers: () => deps.repo.importsWithLeftovers(),
    refusalOf: (jobId) => deps.repo.importRefusal(jobId),
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
  /** 3d Task 3: the edge's purge adapter, built from EDGE_PURGE; off when none is given. */
  edge?: EdgeAdapter;
  /** 3d Task 6: the scorer's model whose scores finalize keeps (the test scorer's under R1_CLASSIFIER=test); none when absent. */
  r1Model?: string | null;
  /** 3d Task 7: the comparison with known material, built from MEDIA_MATCH; off when none is given. */
  match?: MatchAdapter;
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
    r1Model: options.r1Model ?? null,
    match: options.match ?? matchAdapterFrom({ MEDIA_MATCH: "off", APP_SITE: "open" }),
    matches: createMatchRepo(options.apiDb),
    matched: { handler: null },
  };
  const forPosts = mediaForPosts(deps);
  const forAccount = mediaForAccount(deps);
  const forCases = mediaForCases(deps);
  const forImports = mediaForImports(deps);
  const edge = options.edge ?? edgeAdapterFrom({ EDGE_PURGE: "off", APP_SITE: "open" });
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** The interface the account module uses. */
    forAccount,
    /** The interface the moderation module uses: an intake's holds, what a case reaches, the staff's image, the disposal. */
    forCases,
    /** 3b Task 5: the interface the imports module uses. */
    forImports,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** One pass of housekeeping at the given time. The server runs it on a timer; tests call it directly. */
    sweep: (now: Date, options: { reconcile: boolean }) => sweep(deps, now, options),
    /** Starts sweeping every thirty seconds under the shared job lock, and returns the function that stops it. */
    startSweeper: (lock: JobLock) => createSweeper(deps, lock).start(),
    /**
     * 3d Task 3 (design, sections 7.4 and 7.14): starts the edge's job, edge-purge, under the shared job lock, a round
     * fifteen seconds after the last ended, and returns the function that stops it. With the adapter off it closes every
     * outbox row as off.
     */
    startEdge: (lock: JobLock) => createEdgeJob({ repo: deps.repo, adapter: edge, log: deps.log }, lock).start(),
    /**
     * 3d Task 7 (design, sections 5 and 7.8): hands the module the moderation module's handler of a stored refusal or of a
     * match on a posted image (moderation.matched), once that module is built, which is after this one.
     */
    onMatch: (handler: NonNullable<MediaDeps["matched"]["handler"]>) => {
      deps.matched.handler = handler;
    },
    /** 3d Task 7 (7.8 step 6, 7.14): one round of match-retry now; the server runs it on a timer. */
    matchRetry: () => matchRetryRound(deps, finalize),
    /**
     * 3d Task 7: starts match-retry under the shared job lock, a round a minute after the last ended, and returns the
     * function that stops it. With the comparison off a round reads nothing.
     */
    startMatchRetry: (lock: JobLock) => createMatchRetryJob(deps, finalize, lock).start(),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
