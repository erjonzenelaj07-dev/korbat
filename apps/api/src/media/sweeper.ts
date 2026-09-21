import type { MediaDeps } from "./context";
import { finalize } from "./flows/status";

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

export interface SweepReport {
  finalized: number;
  timedOut: number;
  expired: number;
  withdrawn: number;
  orphans: number;
}

/**
 * Housekeeping that no request triggers. It is a plain function of the clock, so tests call it
 * with whatever time they need. Every step is safe to repeat and safe to run next to live traffic.
 */
export async function sweep(deps: MediaDeps, now: Date, options: { reconcile: boolean }): Promise<SweepReport> {
  const report: SweepReport = { finalized: 0, timedOut: 0, expired: 0, withdrawn: 0, orphans: 0 };

  // 1. Results nobody asked for: the composer was closed, or the post was written from another device.
  for (const id of await deps.repo.processingIds()) {
    if (await finalize(deps, id)) report.finalized++;
  }

  // 2. Uploads the worker never answered, because it was down or the file killed it three times.
  const stale = await deps.repo.failStale(new Date(now.getTime() - PROCESSING_TIMEOUT_MS));
  // 3. Uploads nobody posted.
  const expired = await deps.repo.deleteUnattachedBefore(new Date(now.getTime() - UNATTACHED_TTL_MS));
  report.timedOut = stale.length;
  report.expired = expired.length;
  for (const id of [...stale, ...expired]) await deps.files.discardUpload(id);
  await deps.files.requestDeletion([...stale, ...expired]);

  // 4. Deletion requests the worker has carried out, once they are old enough to have covered late writes.
  for (const { id, ageMs } of await deps.files.deletionRequestAges(now.getTime())) {
    if (ageMs < DELETION_GRACE_MS || (await deps.files.imageRemains(id))) continue;
    await deps.files.withdrawDeletion(id);
    report.withdrawn++;
  }

  // 5. What a crash between a commit and a file operation left behind, and the files of deleted
  //    accounts, whose rows went by cascade.
  if (options.reconcile) {
    const nowMs = now.getTime();
    const images = (await deps.files.storedImages(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const uploads = (await deps.files.storedUploads(nowMs)).filter((entry) => entry.ageMs > ORPHAN_AGE_MS).map((entry) => entry.id);
    const known = await deps.repo.existing([...new Set([...images, ...uploads])]);
    const orphanImages = images.filter((id) => !known.has(id));
    const orphanUploads = uploads.filter((id) => !known.has(id));
    await deps.files.requestDeletion(orphanImages);
    for (const id of orphanUploads) await deps.files.discardUpload(id);
    report.orphans = orphanImages.length + orphanUploads.length;
    if (report.orphans > 0) deps.log.warn({ images: orphanImages.length, uploads: orphanUploads.length }, "media: removed files that had no row");
  }
  return report;
}

/** Lets one API instance sweep at a time. The server builds it on Redis; nothing here knows Redis. */
export interface SweepLock {
  /** True when the key was free and is now held for `ttlMs`. */
  acquire(key: string, ttlMs: number): Promise<boolean>;
}

export function createSweeper(deps: MediaDeps, lock: SweepLock) {
  /** One round: skipped when another instance holds the lock; reconciles when that is due. */
  async function round(): Promise<SweepReport | null> {
    if (!(await lock.acquire("media:sweeper", SWEEP_INTERVAL_MS - 5_000))) return null;
    const reconcile = await lock.acquire("media:sweeper:reconcile", RECONCILE_INTERVAL_MS);
    return sweep(deps, deps.now(), { reconcile });
  }
  return {
    round,
    /** Sweeps every thirty seconds until the returned function is called. */
    start(): () => void {
      const timer = setInterval(() => void round().catch((err: unknown) => deps.log.error({ err }, "media: sweep failed")), SWEEP_INTERVAL_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
