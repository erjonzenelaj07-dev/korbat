import { createJob, type JobLock } from "../lib/jobs";
import type { MediaDeps } from "./context";
import { finalize } from "./flows/status";
import { requestOwed } from "./owed";

/** An upload the worker has not answered for this long has failed. Normal processing takes seconds. */
export const PROCESSING_TIMEOUT_MS = 5 * 60_000;
/** An upload nobody put on a post within a day is removed. */
export const UNATTACHED_TTL_MS = 24 * 60 * 60_000;
/** Files without a row are only treated as orphans once they are this old, so work in flight is never touched. */
export const ORPHAN_AGE_MS = 60 * 60_000;
/**
 * A deletion request stays at least this long. The worker may be in the middle of an image when
 * the request arrives, and writes its files afterwards; one image takes at most two minutes before
 * the worker's watchdog ends it, so after ten the request has been seen with everything in place.
 */
export const DELETION_GRACE_MS = 10 * 60_000;
export const SWEEP_INTERVAL_MS = 30_000;
export const RECONCILE_INTERVAL_MS = 10 * 60_000;
/**
 * Reconcile refuses to delete images without a row when there are more of them than both of these:
 * a database restored from an older snapshot has rows missing for every image posted since, and
 * those images must not go. MEDIA_RECONCILE=force overrides it once the operator has checked.
 */
export const RECONCILE_MAX_ORPHANS = 50;
export const RECONCILE_MAX_ORPHAN_SHARE = 0.02;

export interface SweepReport {
  finalized: number;
  timedOut: number;
  expired: number;
  withdrawn: number;
  orphans: number;
  /** Orphan images the reconcile pass refused to delete. */
  refused: number;
}

/**
 * Housekeeping that no request triggers. It is a plain function of the clock, so tests call it
 * with whatever time they need. Every step is safe to repeat and safe to run next to live traffic.
 */
export async function sweep(deps: MediaDeps, now: Date, options: { reconcile: boolean }): Promise<SweepReport> {
  const report: SweepReport = { finalized: 0, timedOut: 0, expired: 0, withdrawn: 0, orphans: 0, refused: 0 };

  // 1. Results nobody asked for: the composer was closed, or the post was written from another device.
  for (const id of await deps.repo.processingIds()) {
    if (await finalize(deps, id)) report.finalized++;
  }

  // 2. Uploads the worker never answered, because it was down or the file killed it three times. 3b Task 5: never an
  //    imported image of an import whose row exists, which the import settles itself after IMPORT_RULES.checkHours (its
  //    feeder puts at most two in the worker's way, and a busy worker is no failure of the image).
  const stale = await deps.repo.failStale(new Date(now.getTime() - PROCESSING_TIMEOUT_MS));
  // 3. Uploads nobody posted. 3b Task 5: never an imported image of an import whose row exists, which waits for its post
  //    however long the preparation takes, or goes with the import's leftovers (import-drive, media.forImports).
  const expired = await deps.repo.deleteUnattachedBefore(new Date(now.getTime() - UNATTACHED_TTL_MS));
  report.timedOut = stale.length;
  report.expired = expired.length;
  for (const id of [...stale, ...expired]) await deps.files.discardUpload(id);
  await deps.files.requestDeletion([...stale, ...expired]);

  // 4. Deletions that are owed: rows the account's purge or the disposal deleted whose request was never written (the
  //    process stopped after the commit, or the request failed), asked for now; and the notes of rows that are still
  //    there, forgotten once they are stale. Every pass, so a request that could not be written is retried within
  //    thirty seconds of the volume taking writes again, however many files it names: these are known deletions, not
  //    orphans, and the reconcile pass below never has to judge them.
  await requestOwed(deps, now.getTime());

  // 5. Deletion requests the worker has carried out, once they are old enough to have covered late writes.
  for (const { id, ageMs } of await deps.files.deletionRequestAges(now.getTime())) {
    if (ageMs < DELETION_GRACE_MS || (await deps.files.imageRemains(id))) continue;
    await deps.files.withdrawDeletion(id);
    report.withdrawn++;
  }

  // 6. What a crash between a commit and a file operation left behind, and the files of deleted
  //    accounts, whose rows went by cascade.
  if (options.reconcile && deps.reconcileMode !== "off") {
    const nowMs = now.getTime();
    const stored = await deps.files.storedImages(nowMs);
    const images = stored.filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    // 2d Task 3: an avatar's upload and its job file are two entries of one id, counted once.
    const uploads = [...new Set((await deps.files.storedUploads(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id))];
    const known = await deps.repo.existing([...new Set([...images, ...uploads])]);
    const orphanImages = images.filter((id) => !known.has(id));
    const orphanUploads = uploads.filter((id) => !known.has(id));
    for (const id of orphanUploads) await deps.files.discardUpload(id);
    const tooMany = orphanImages.length > RECONCILE_MAX_ORPHANS && orphanImages.length > stored.length * RECONCILE_MAX_ORPHAN_SHARE;
    if (tooMany && deps.reconcileMode !== "force") {
      report.refused = orphanImages.length;
      report.orphans = orphanUploads.length;
      deps.log.error(
        { images: orphanImages.length, stored: stored.length },
        "media: reconcile refused to delete this many images without a row. If the database was restored from an older snapshot, restore the store from the same one; if the images are really orphans, set MEDIA_RECONCILE=force for one pass",
      );
    } else {
      await deps.files.requestDeletion(orphanImages);
      report.orphans = orphanImages.length + orphanUploads.length;
      if (report.orphans > 0) deps.log.warn({ images: orphanImages.length, uploads: orphanUploads.length }, "media: removed files that had no row");
    }
  }
  return report;
}

/**
 * The sweeper as a job: one instance at a time, rounds never overlapping, the lock refreshed while a
 * long reconcile runs. The reconcile marker is a second key that simply expires every ten minutes.
 */
export function createSweeper(deps: MediaDeps, lock: JobLock) {
  let last: SweepReport | null = null;
  const job = createJob({
    name: "media-sweeper",
    intervalMs: SWEEP_INTERVAL_MS,
    lockTtlMs: SWEEP_INTERVAL_MS,
    lock,
    log: deps.log,
    run: async () => {
      const reconcile = await lock.acquire("job:media-sweeper:reconcile", "due", RECONCILE_INTERVAL_MS);
      last = await sweep(deps, deps.now(), { reconcile });
    },
  });
  return {
    /** One round now: the report, or null when another instance holds the lock or a round is still in flight. */
    async round(): Promise<SweepReport | null> {
      last = null;
      return (await job.round()) === "ran" ? last : null;
    },
    /** Sweeps every thirty seconds until the returned function is called. */
    start: job.start,
  };
}
