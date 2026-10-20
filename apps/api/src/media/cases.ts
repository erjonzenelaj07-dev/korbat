import type { EdgePurgeView, MatchRecord, MediaSize } from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import { VARIANTS } from "@korbat/media-protocol";
import type { MediaDeps } from "./context";
import type { StoredFile } from "./files";
import { createMatchRepo, type MatchRepo, type OwnRefusal, type RefusalRow, type Runner } from "./match-repo";
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
   * file whose header says that it is a WebP of the size its variant and its row allow. 3d Task 7 (sections 5 and 7.11,
   * review ruling 2): never an image that an unerased match record names, an acting match or a flag, whatever its state and
   * whatever was answered, which it answers "matched", so the route can say why.
   */
  staffImage(mediaId: string, size: MediaSize): Promise<StaffImage | "matched" | null>;
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
   * 3d Task 7 (design, sections 5 and 7.9): the match record by its id, as staff are shown it, with its image, its case,
   * whether the program is done with it and whether it is erased; null when there is none. Through the caller's
   * connection or transaction; it locks nothing.
   */
  matchRecord(q: Runner, matchId: string): Promise<(MatchRecord & { id: string; mediaId: string; caseId: string | null; handled: boolean; erased: boolean }) | null>;
  /** The records of these match ids, as the case page shows them, keyed by id. */
  matchRecords(matchIds: readonly string[]): Promise<Map<string, MatchRecord>>;
  /**
   * The automated step's write, in the step's transaction (review ruling 8): the record is marked handled and, with a case,
   * names it once. The media module owns the table.
   */
  matchJoined(tx: Runner, matchId: string, caseId: string | null): Promise<void>;
  /**
   * 3d review H1: an entry whose signal met the image's existing one: the record is marked handled with no case, unless a
   * signal names it, whose step alone marks it.
   */
  matchPassed(tx: Runner, matchId: string): Promise<void>;
  /** Which of these images an unerased match record names: the case page's [case.image.matched]. */
  matchedImages(mediaIds: readonly string[]): Promise<Set<string>>;
  /** 3d Task 7 (7.12 step 1): one of the uploader's refusals, as its notice reads it; null for anyone else's. */
  refusalOf(ownerId: string, refusalId: string): Promise<OwnRefusal | null>;
  /** The uploader's refusals, newest first, after a cursor's (time, id), at most `limit`, each with its sort key. */
  refusalsOf(ownerId: string, after: { at: string; id: string } | null, limit: number): Promise<{ id: string; at: string; key: string }[]>;
  /**
   * 7.12 step 2: the one statement that writes an objection, under the rule the guard states; `not_open` when it changed
   * no row of the owner's, `not_found` for a refusal that is not theirs.
   */
  objectToRefusal(ownerId: string, refusalId: string, text: string): Promise<"objected" | "not_open" | "not_found">;
  /** The dispatch round's notices (7.14): the refusals whose notice is owed, and its outcome. */
  refusalsUntold(limit: number): Promise<{ id: string; ownerId: string | null; refusedAt: string }[]>;
  refusalTold(refusalId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void>;
  /** The holds ended as no_report whose delay has passed and whose notice that the hold was lifted is owed, and its outcome. */
  liftedUntold(limit: number): Promise<{ id: string; ownerId: string | null; endedAt: string }[]>;
  liftedTold(refusalId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void>;
  /** Held uploads (7.12 step 3): a page from `offset`, one row more than a page; and one refusal as the list shows it. */
  heldList(offset: number): Promise<RefusalRow[]>;
  held(refusalId: string): Promise<RefusalRow | null>;
  /** Home's [home.uploads] and the urgent alert's heldUploads (8.2, W.7). */
  heldOverview(): Promise<{ open: number; oldest: string | null; objected: number; capped: number }>;
  /** Home's [home.unreported]: the holds ended as no_report in the last `days` days, newest first. */
  recentUnreported(days: number, max: number): Promise<{ at: string; refusalId: string }[]>;
  /** The uploader and the image of a refusal, for the end's and the release's transactions. */
  refusalSubject(q: Runner, refusalId: string): Promise<{ ownerId: string | null; mediaId: string } | null>;
  /** matcher_down's facts at once (7.8): how many checks are unanswered and since when, and how many wait under the limit. */
  checkCounts(): Promise<{ unchecked: number; capped: number; oldestUnchecked: string | null }>;
  /**
   * 3d Task 6 (design, sections 5 and 7.9): the automated sweep's read of images without a signal: with `r1` (its
   * threshold, read only while the scorer is not off), every image of a post created in the last `hours` hours whose
   * score is at or over it and that no score's signal names; at most `limit`. Task 7 adds the match records not marked
   * handled, read only while the matcher is not off.
   */
  unsignalled(limit: number, options: { hours: number; r1: { threshold: number } | null; match?: boolean }): Promise<UnsignalledImage[]>;
  /**
   * 3d Task 8 (design, sections 5 and 7.14): the retention job's statements on this module's tables, each in the caller's
   * transaction, whose audit row the job writes after it; each answers how many rows it changed. The step tools_off calls
   * forgetHashes while MEDIA_MATCH is off (every row of media_hashes) and forgetScores while R1_CLASSIFIER is off (every
   * rating no unhandled signal names); the step edge_purges calls forgetPurges (the outbox rows of the edge done
   * EDGE_RULES.keepDays ago).
   */
  forgetHashes(tx: DbTx): Promise<number>;
  forgetScores(tx: DbTx): Promise<number>;
  forgetPurges(tx: DbTx): Promise<number>;
}

/**
 * 3d Task 6: an image of a post as the automated step reads it: its id and its score. 3d Task 7: and its unerased match
 * record, preferring one the program is not done with: its id, whether it is listed and acting, and whether it is handled.
 */
export interface ImageSignals {
  mediaId: string;
  score: number | null;
  match: { id: string; listed: boolean; acting: boolean; handled: boolean } | null;
}

/**
 * 3d Task 6: an image the sweep found without its signal: a score at or over the threshold. 3d Task 7: or a posted image
 * with a match record the program is not done with.
 */
export type UnsignalledImage = { kind: "r1_score"; mediaId: string; postId: string; score: number } | { kind: "known_match"; mediaId: string; postId: string; matchId: string };

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
export function mediaForCases(input: Pick<MediaDeps, "repo" | "files" | "log"> & { matches?: MatchRepo; now?: () => Date }): MediaForCases {
  // 3d Task 7: the statements on the known material's tables, built over the repository's own pool when none is given.
  const deps = { ...input, matches: input.matches ?? createMatchRepo(input.repo.pool) };
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
      // 3d Task 7: an image a match names stays closed to staff before an answer and after it, on every case.
      if (access.matched) return "matched";
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
    async signals(q, postId) {
      const images = await deps.repo.signals(q, postId);
      const records = await deps.matches.recordsOfImages(q, images.map((image) => image.mediaId));
      return images.map((image) => ({ ...image, match: records.get(image.mediaId) ?? null }));
    },
    async unsignalled(limit, options) {
      // Each read runs only while its tool's adapter is not off (7.9): the caller passes the score's threshold, and
      // `match` only while the comparison is on. Matches first: a known match must not wait behind a burst of scores.
      const matches = options.match === true ? (await deps.matches.unhandledOnPosts(limit)).map((image) => ({ kind: "known_match" as const, ...image })) : [];
      if (options.r1 === null) return matches;
      const scores = (await deps.repo.unsignalledScores(limit - matches.length, options.hours, options.r1.threshold)).map((image) => ({ kind: "r1_score" as const, ...image }));
      return [...matches, ...scores];
    },
    matchRecord: (q, matchId) => deps.matches.record(q, matchId),
    matchRecords: (matchIds) => deps.matches.records(matchIds),
    matchJoined: (tx, matchId, caseId) => deps.matches.joined(tx, matchId, caseId),
    matchPassed: (tx, matchId) => deps.matches.passed(tx, matchId),
    matchedImages: (mediaIds) => deps.matches.matched(deps.matches.db, mediaIds),
    refusalOf: (ownerId, refusalId) => deps.matches.ownRefusal(ownerId, refusalId),
    refusalsOf: (ownerId, after, limit) => deps.matches.refusalsOf(ownerId, after, limit),
    async objectToRefusal(ownerId, refusalId, text) {
      if (await deps.matches.object(ownerId, refusalId, text)) return "objected";
      return (await deps.matches.owns(ownerId, refusalId)) ? "not_open" : "not_found";
    },
    refusalsUntold: (limit) => deps.matches.refusalsUntold(limit),
    refusalTold: (refusalId, outcome) => deps.matches.refusalTold(refusalId, outcome),
    liftedUntold: (limit) => deps.matches.liftedUntold(limit),
    liftedTold: (refusalId, outcome) => deps.matches.liftedTold(refusalId, outcome),
    heldList: (offset) => deps.matches.heldList(offset),
    held: (refusalId) => deps.matches.held(refusalId),
    heldOverview: () => deps.matches.heldOverview(),
    recentUnreported: (days, max) => deps.matches.recentUnreported(days, max),
    refusalSubject: (q, refusalId) => deps.matches.refusalSubject(q, refusalId),
    checkCounts: () => deps.matches.checkCounts(),
    forgetHashes: (tx) => deps.matches.forgetHashes(tx),
    forgetScores: (tx) => deps.repo.forgetScores(tx),
    forgetPurges: (tx) => deps.repo.forgetPurges(tx),
  };
}
