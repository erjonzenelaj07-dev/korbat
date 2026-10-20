import type { EdgePurgeView, MediaSize } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { VARIANTS } from "@korbat/media-protocol";
import type { MediaDeps } from "./context";
import type { StoredFile } from "./files";
import { owedLate, requestOwed } from "./owed";
import type { CaseReach, HeldImage, HoldPair } from "./repo";
import { RECONCILE_MAX_ORPHANS } from "./sweeper";
import { WEBP_HEADER_BYTES, webpSize } from "./webp";

/**
 * How many image rows one call of dropDisposable deletes at most: half of what the reconcile pass deletes without
 * MEDIA_RECONCILE=force. The files of a batch are requested after its commit; a batch notes inside its transaction that
 * they are owed, so a crash in between, or a request that cannot be written, loses nothing: the note is what the request
 * is written from later. Should the notes be lost as well (an uploads volume put back from an older copy), one batch's
 * files, with other deletions' lost in the same way, still stay within what one reconcile pass removes by itself (3c
 * design, section 5).
 */
export const DISPOSAL_BATCH = RECONCILE_MAX_ORPHANS / 2;

/** An image file opened for staff, with the post it is on. The caller reads the handle from its start and closes it. */
export interface StaffImage {
  postId: string;
  file: StoredFile;
}

/**
 * What the moderation module needs from this one (3c design, section 5). The moderation module never names an image
 * row: it hands over its transaction, its cases and its targets, and gets back what its evidence lists and what its
 * screens count.
 */
export interface MediaForCases {
  /**
   * An intake's holds, inside its transaction: each pair `{ caseId, postId }` locks the post's image rows and places
   * the case's evidence hold on them; a pair `{ ownerId }` only locks every image row on that account's posts, for a
   * report of child sexual abuse material about the account. All rows are locked by one statement, in one id order.
   * It answers each post pair's images in position order, for the post's snapshot; an empty list means they are gone.
   */
  hold(tx: DbTx, pairs: readonly HoldPair[]): Promise<Map<string, HeldImage[]>>;
  /**
   * Opens an image file for staff, or answers null: the only function that does (gate V; 3c design, sections 6.1 and
   * 7.3). Never an image of a frozen post, a sealed image or an erased one, on whatever case the request came; and only a
   * file whose header says that it is a WebP of the size its variant and its row allow.
   */
  staffImage(mediaId: string, size: MediaSize): Promise<StaffImage | null>;
  /** What a case about this post or account reaches: counts, a day and a time, never an id, an alt text or a file. */
  reach(target: { type: "post" | "account"; id: string }): Promise<CaseReach>;
  /**
   * Deletes, in the caller's transaction, at most DISPOSAL_BATCH image rows that nothing retains and that their post's
   * deletion, their owner's purge or an erasure left behind, the lowest ids first, and answers their ids. Still inside
   * that transaction it notes that their files are owed a request: where the note cannot be written this throws, the
   * transaction fails, and no row is gone whose files could not be found again. The caller asks for the files with
   * requestDeletion after its commit, and calls again until fewer than a batch came back.
   */
  dropDisposable(tx: DbTx): Promise<string[]>;
  /**
   * How many erasures of images are late: the rows the disposal should have taken more than a day ago, and the files of
   * rows that are gone whose request has been owed for longer than a round of the retention job.
   */
  overdueDeletions(): Promise<number>;
  /**
   * Asks the worker to delete the files of these images, and settles what was owed for them. Called after the commit of
   * the transaction that deleted their rows. When it throws, the deletion stays owed.
   */
  requestDeletion(ids: readonly string[]): Promise<void>;
  /**
   * Asks again for the files of every row that is gone and whose request was never written, whoever deleted the row
   * (a batch of the disposal, or the account's purge), and answers how many are still owed afterwards. The disposal calls
   * it before its first batch of a round and takes none while the answer is not zero.
   */
  requestOwed(): Promise<number>;
  /**
   * 3d (design, sections 6.1, 7.1 and 7.14): up to `limit` images whose files the quarantine's record says are lost and
   * whose author is owed the notice, the earliest first, with the author and the post's creation time while the image
   * row and its post are there (null otherwise). The dispatch job mails each and records the outcome with lostTold.
   */
  lostUntold(limit: number): Promise<LostImage[]>;
  /** 3d: the outcome of a lost image's notice, which changes only a notice still pending. */
  lostTold(mediaId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void>;
  /**
   * 3d Task 3 (design, sections 7.4 and 10.3): for each of these images that stopped being public, in the order given, its
   * newest outbox row of the edge: the purge's outcome, or pending, and its time. The moderation module never names the
   * outbox: a case's purge lines are read through this member.
   */
  purges(mediaIds: readonly string[]): Promise<EdgePurgeView[]>;
  /** 3d Task 3: the same for every image of these posts, by post, in their order on the post: the purge lines of an order's items. */
  postPurges(postIds: readonly string[]): Promise<Map<string, EdgePurgeView[]>>;
  /**
   * 3d Task 6 (design, section 5): for each ready, unerased image of the post, in position order, its id and its score
   * (null when none was stored), through the caller's connection or transaction. It locks nothing. Task 7 adds each
   * image's unerased match record.
   */
  signals(q: Pick<Db, "execute"> | Pick<DbTx, "execute">, postId: string): Promise<ImageSignals[]>;
  /**
   * 3d Task 6 (design, sections 5 and 7.9): the automated sweep's read of images without a signal: with `r1` (its
   * threshold, read only while the scorer is not off), every image of a post created in the last `hours` hours whose
   * score is at or over it and that no score's signal names; at most `limit`. Task 7 adds the match records not marked
   * handled, read only while the matcher is not off.
   */
  unsignalled(limit: number, options: { hours: number; r1: { threshold: number } | null }): Promise<UnsignalledImage[]>;
}

/** 3d Task 6: an image of a post as the automated step reads it: its id and its score. */
export interface ImageSignals {
  mediaId: string;
  score: number | null;
}

/** 3d Task 6: an image the sweep found without its signal: a score at or over the threshold. */
export interface UnsignalledImage {
  kind: "r1_score";
  mediaId: string;
  postId: string;
  score: number;
}

/** 3d: an image whose files are lost, as the dispatch job tells its author of it. */
export interface LostImage {
  mediaId: string;
  lostAt: Date;
  ownerId: string | null;
  postCreatedAt: Date | null;
}

/**
 * The moderation module's interface over this module's dependencies, as createMedia hands it out; the tests build it the
 * same way. The clock is read only for the age of what is owed; without one it is the machine's.
 */
export function mediaForCases(deps: Pick<MediaDeps, "repo" | "files" | "log"> & { now?: () => Date }): MediaForCases {
  const nowMs = () => (deps.now?.() ?? new Date()).getTime();

  /**
   * Why a file of the store is not the image its row describes, or null when it is. The store is written by the worker,
   * which runs the decoder, so the bytes are not trusted: the console is given a file only when its first bytes are those
   * of a WebP whose longer side fits the variant, and whose large variant is exactly as large as the row says.
   */
  async function fault(file: StoredFile, size: MediaSize, row: { width: number | null; height: number | null }): Promise<string | null> {
    const head = Buffer.alloc(WEBP_HEADER_BYTES);
    // Read at an explicit position, which leaves the handle's own position at the start for whoever streams the file.
    const { bytesRead } = await file.handle.read(head, 0, WEBP_HEADER_BYTES, 0);
    const stated = webpSize(head.subarray(0, bytesRead));
    if (!stated) return "not a WebP file";
    if (Math.max(stated.width, stated.height) > VARIANTS[size].edge) return "larger than its variant may be";
    if (size === "large" && (stated.width !== row.width || stated.height !== row.height)) return "not the size its row states";
    return null;
  }

  return {
    hold: (tx, pairs) => deps.repo.hold(tx, pairs),

    async staffImage(mediaId, size) {
      const access = await deps.repo.staffAccess(mediaId);
      if (!access || access.status !== "ready") return null;
      // Gate V. The image's state is asked for by name: a state this reader has not been taught opens nothing.
      const shown = access.mediaState === "visible" || access.mediaState === "withheld" || access.mediaState === "removed";
      if (!shown || access.frozen || access.erased) return null;
      const file = await deps.files.openImage(mediaId, size);
      if (!file) return null;
      let reason: string | null;
      try {
        reason = await fault(file, size, access);
      } catch (err) {
        await file.handle.close();
        throw err;
      }
      if (reason !== null) {
        await file.handle.close();
        deps.log.error({ id: mediaId, size, reason }, "media store: refused to open for staff a file that is not the image its row describes");
        return null;
      }
      return { postId: access.postId, file };
    },

    reach: (target) => deps.repo.reach(target),
    async dropDisposable(tx) {
      const ids = await deps.repo.dropDisposable(tx, DISPOSAL_BATCH);
      await deps.files.oweDeletion(ids);
      return ids;
    },
    overdueDeletions: async () => (await deps.repo.overdueDeletions()) + (await owedLate(deps, nowMs())),
    async requestDeletion(ids) {
      await deps.files.requestDeletion(ids);
      await deps.files.settleOwed(ids);
    },
    requestOwed: async () => (await requestOwed(deps, nowMs())).owed,
    lostUntold: (limit) => deps.repo.lostUntold(limit),
    lostTold: (mediaId, outcome) => deps.repo.lostTold(mediaId, outcome),
    purges: (mediaIds) => deps.repo.purges(mediaIds),
    postPurges: (postIds) => deps.repo.postPurges(postIds),
    signals: (q, postId) => deps.repo.signals(q, postId),
    async unsignalled(limit, options) {
      if (options.r1 === null) return [];
      return (await deps.repo.unsignalledScores(limit, options.hours, options.r1.threshold)).map((image) => ({ kind: "r1_score" as const, ...image }));
    },
  };
}
