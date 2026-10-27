import { IMPORT_RULES, type ImportFailure } from "@korbat/contracts";
import { createJob, type JobLock } from "../lib/jobs";
import type { ImportDeps } from "./context";
import { feedRound } from "./feeder";
import { endFiles } from "./flows/end";
import { runIntake, type IntakeCaps } from "./intake";
import { PUBLISH_SIZES, publishRound } from "./publisher";

/**
 * The job import-drive (3b design, section 7.5): every five seconds, under the shared job lock, one round that moves the
 * imports along. A round is a plain function of the clock, so tests run it with any time, and each step is safe to
 * repeat. Task 4 builds steps 1 to 3 (scans done, the intake, the time limits of 4.8, each one statement), 7 (retention)
 * and 8 (orphans, every tenth round); Task 5 step 4 (feeding, feeder.ts) and the leftovers of 7.4; Task 6 steps 5
 * (publishing, publisher.ts) and 6 (undoing), after the leftovers. A round never holds a lock across rounds, and a failure
 * of one import's step is logged and passes on to the next.
 */

export interface DriveReport {
  /** Scans whose summary the round read: moved to ready, or to failed. */
  ready: number;
  failed: number;
  /** The bounds of 4.8. */
  expiredUploads: number;
  timedOutScans: number;
  expiredPreviews: number;
  stoppedLate: number;
  /** Step 4 (Task 5): images fed, left out before a row, settled as left out and among them flagged; a refusal's stop; the move to publishing. */
  fed: number;
  skipped: number;
  leftOut: number;
  flagged: number;
  refused: number;
  publishing: number;
  /** 7.4: rows on no post of imports that have ended, deleted. */
  leftovers: number;
  /** Step 5 (Task 6): posts written, imports done, and imports whose author's suspension made them wait. */
  postsPublished: number;
  done: number;
  paused: number;
  /** Step 6 (Task 6): posts tombstoned by undos, and imports undone. */
  postsRemoved: number;
  undone: number;
  /** Step 7. */
  picksDeleted: number;
  rowsDeleted: number;
  /** Step 8: archive folders and markers deleted, work folders asked for, requests withdrawn. */
  orphanArchives: number;
  orphanWork: number;
  withdrawn: number;
}

/** States whose import still needs its work folder: the scan writes it, the preview and the later steps read it. */
const NEEDS_WORK = new Set(["scanning", "ready", "preparing", "publishing"]);
/** States whose import still needs its archive: the upload writes it, the scan reads it. */
const NEEDS_ARCHIVE = new Set(["uploading", "scanning"]);

/** Tests only: the intake's caps, and (Task 6) smaller batches: posts a batch, publishing and undo batches a round. */
export interface DriveOptions {
  orphans: boolean;
  caps?: Partial<IntakeCaps>;
  batches?: { posts?: number; publish?: number; undo?: number };
}

/** Steps 1 and 2: each import in scanning whose importer has written its summary. */
async function scansDone(deps: ImportDeps, now: Date, report: DriveReport, caps: Partial<IntakeCaps> | undefined): Promise<void> {
  for (const job of await deps.repo.scanning()) {
    try {
      const summary = await deps.files.readSummary(job.id);
      // No summary yet: the importer has not finished, or not started.
      if (!summary.ok && summary.code === "missing") continue;
      // The archive is read once the summary is: it goes at once, with its marker (decision 4).
      await deps.files.removeArchive(job.id);
      let failure: ImportFailure | null = null;
      if (!summary.ok) {
        // A summary the API cannot take (not JSON, not the contract, another import's, a link): the scan is unreadable.
        deps.log.error({ id: job.id, code: summary.code }, "import: the scan's summary was refused");
        failure = "unreadable";
      } else if (summary.value.status === "failed") {
        failure = summary.value.failure;
      } else {
        const young = now.getTime() - job.ownerCreatedAt.getTime() < IMPORT_RULES.newAccountDays * 86_400_000;
        const intake = await runIntake({
          id: job.id,
          summary: summary.value,
          images: job.images,
          createdAt: job.createdAt,
          young,
          known: (keys) => deps.social.importedKeys(job.ownerId, keys),
          files: deps.files,
          log: deps.log,
          caps,
        });
        if (intake.ok) {
          if (await deps.repo.toReady(job.id, intake.scan, now)) report.ready++;
          continue;
        }
        deps.log.error({ id: job.id, code: intake.code }, "import: posts.jsonl was refused");
        failure = "unreadable";
      }
      if (await deps.repo.failScan(job.id, failure, now)) {
        report.failed++;
        deps.log.info({ id: job.id, phase: "failed", failure }, "import: the scan failed");
      }
      // A failed scan's work folder is of no use; the importer writes none for most failures, and deletes what is there.
      await deps.files.requestWorkDeletion(job.id);
    } catch (err) {
      deps.log.error({ id: job.id, err }, "import: a scan's end could not be handled; the next round tries again");
    }
  }
}

/** Step 3: the bounds of 4.8, each one statement, and then the files of what they ended. */
async function timeLimits(deps: ImportDeps, now: Date, report: DriveReport): Promise<void> {
  const uploads = await deps.repo.expireUploads(now);
  const scans = await deps.repo.timeOutScans(now);
  const previews = await deps.repo.expirePreviews(now);
  const late = await deps.repo.stopTimedOut(now);
  report.expiredUploads = uploads.length;
  report.timedOutScans = scans.length;
  report.expiredPreviews = previews.length;
  report.stoppedLate = late.length;
  for (const id of [...uploads, ...scans, ...previews, ...late]) await endFiles(deps, id);
  if (uploads.length + scans.length + previews.length + late.length > 0) {
    deps.log.info({ expiredUploads: uploads.length, timedOutScans: scans.length, expiredPreviews: previews.length, stoppedLate: late.length }, "import-drive: time limits");
  }
}

/** Step 4: the feeder of 7.4 for the import in preparing confirmed longest ago. */
async function feeding(deps: ImportDeps, now: Date, report: DriveReport): Promise<void> {
  try {
    const fed = await feedRound(deps, now);
    if (fed === null) return;
    report.fed = fed.fed;
    report.skipped = fed.skipped;
    report.leftOut = fed.leftOut;
    report.flagged = fed.flagged;
    report.refused = fed.refused ? 1 : 0;
    report.publishing = fed.published ? 1 : 0;
  } catch (err) {
    deps.log.error({ err }, "import: the feeder's round failed; the next round tries again");
  }
}

/**
 * 7.4: every import that has left preparing and publishing (stopped by its author, a refusal, a time limit or an admin,
 * done, undone) and still has image rows on no post, each round and not once on the move: the rows go in a transaction
 * of their own through the media module, which notes their files as owed, and their files are asked for after the
 * commit. A row a refusal holds stays (the keep trigger), and is not asked about while its hold stands.
 */
async function leftovers(deps: ImportDeps, report: DriveReport): Promise<void> {
  const ids = await deps.media.importsWithLeftovers();
  if (ids.length === 0) return;
  const statuses = await deps.repo.statuses(ids);
  for (const id of ids) {
    const status = statuses.get(id);
    if (status === undefined || status === "preparing" || status === "publishing") continue;
    try {
      const gone = await deps.repo.transaction((tx) => deps.media.deleteImportLeftovers(tx, id));
      await deps.media.releaseFiles(gone);
      report.leftovers += gone.length;
    } catch (err) {
      deps.log.error({ id, err }, "import: an ended import's images could not be deleted; the next round tries again");
    }
  }
  if (report.leftovers > 0) deps.log.info({ leftovers: report.leftovers }, "import-drive: images of ended imports deleted");
}

/**
 * Step 5 (Task 6): each import that was publishing when the round began, up to publishBatchesPerRound batches of
 * batchPosts lines each (publisher.ts). An import whose images settled in this round's feeding publishes from the next
 * round, five seconds on: its rows on no post are then those the batches attach. A suspended author's import waits.
 */
async function publishing(deps: ImportDeps, imports: Awaited<ReturnType<ImportDeps["repo"]["publishing"]>>, now: Date, report: DriveReport, batches: DriveOptions["batches"]): Promise<void> {
  const sizes = { posts: batches?.posts ?? PUBLISH_SIZES.posts, batches: batches?.publish ?? PUBLISH_SIZES.batches };
  for (const job of imports) {
    try {
      const round = await publishRound(deps, job, now, sizes);
      report.postsPublished += round.posts;
      if (round.done) report.done++;
      if (round.paused) report.paused++;
    } catch (err) {
      deps.log.error({ id: job.id, err }, "import: a publishing batch failed; the next round tries again");
    }
  }
  if (report.postsPublished > 0) deps.log.info({ posts: report.postsPublished, done: report.done }, "import-drive: published");
}

/**
 * Step 6 (Task 6): each import in undoing, up to undoBatchesPerRound batches of batchPosts posts through the social
 * module's removeImportedBatch, the author's own deletion path; a batch that finds no post of the import left that is
 * neither deleted nor disabled moves it to undone.
 */
async function undoing(deps: ImportDeps, now: Date, report: DriveReport, batches: DriveOptions["batches"]): Promise<void> {
  const limit = batches?.posts ?? IMPORT_RULES.batchPosts;
  const rounds = batches?.undo ?? IMPORT_RULES.undoBatchesPerRound;
  for (const job of await deps.repo.undoing()) {
    try {
      for (let batch = 0; batch < rounds; batch++) {
        const removed = await deps.social.removeImportedBatch(job, now, limit);
        report.postsRemoved += removed.removed;
        if (removed.selected > 0) continue;
        if (await deps.repo.toUndone(job.id)) {
          report.undone++;
          deps.log.info({ id: job.id, phase: "undone" }, "import: undone");
        }
        break;
      }
    } catch (err) {
      deps.log.error({ id: job.id, err }, "import: an undo batch failed; the next round tries again");
    }
  }
}

/**
 * Step 8: what a crash between a commit and a file operation left behind, once older than an hour. An archive folder or
 * a queue marker goes unless its import is still uploading or scanning; a work folder is asked for unless its import
 * still needs it; a deletion request is withdrawn once the importer has carried it out and an hour has passed, so a scan
 * that was aborted has long seen it.
 */
async function orphans(deps: ImportDeps, now: Date, report: DriveReport): Promise<void> {
  const at = now.getTime();
  const old = (entries: { id: string; ageMs: number }[]) => entries.filter((entry) => entry.ageMs > IMPORT_RULES.orphanAgeMs);
  const folders = old(await deps.files.archiveFolders(at));
  const markers = old(await deps.files.queueMarkers(at));
  const work = old(await deps.files.workFolders(at));
  const requests = await deps.files.deletionRequests(at);
  const statuses = await deps.repo.statuses([...new Set([...folders, ...markers, ...work].map((entry) => entry.id))]);
  for (const id of new Set([...folders, ...markers].map((entry) => entry.id))) {
    const status = statuses.get(id);
    if (status !== undefined && NEEDS_ARCHIVE.has(status)) continue;
    await deps.files.removeArchive(id);
    report.orphanArchives++;
  }
  const requested = new Set(requests.map((entry) => entry.id));
  for (const { id } of work) {
    const status = statuses.get(id);
    if ((status !== undefined && NEEDS_WORK.has(status)) || requested.has(id)) continue;
    await deps.files.requestWorkDeletion(id);
    report.orphanWork++;
  }
  for (const { id, ageMs } of requests) {
    if (ageMs <= IMPORT_RULES.orphanAgeMs || (await deps.files.workFolderPresent(id))) continue;
    await deps.files.withdrawWorkDeletion(id);
    report.withdrawn++;
  }
  if (report.orphanArchives + report.orphanWork + report.withdrawn > 0) {
    deps.log.warn({ archives: report.orphanArchives, work: report.orphanWork, withdrawn: report.withdrawn }, "import-drive: orphans");
  }
}

/** One round at `now`. */
export async function driveRound(deps: ImportDeps, now: Date, options: DriveOptions): Promise<DriveReport> {
  const report: DriveReport = {
    ready: 0,
    failed: 0,
    expiredUploads: 0,
    timedOutScans: 0,
    expiredPreviews: 0,
    stoppedLate: 0,
    fed: 0,
    skipped: 0,
    leftOut: 0,
    flagged: 0,
    refused: 0,
    publishing: 0,
    leftovers: 0,
    postsPublished: 0,
    done: 0,
    paused: 0,
    postsRemoved: 0,
    undone: 0,
    picksDeleted: 0,
    rowsDeleted: 0,
    orphanArchives: 0,
    orphanWork: 0,
    withdrawn: 0,
  };
  await scansDone(deps, now, report, options.caps);
  await timeLimits(deps, now, report);
  // The imports that publish as the round begins (step 5 takes these, after the feeding and the leftovers).
  const publishable = await deps.repo.publishing();
  await feeding(deps, now, report);
  await leftovers(deps, report);
  await publishing(deps, publishable, now, report, options.batches);
  await undoing(deps, now, report, options.batches);
  const kept = await deps.repo.retention(now);
  report.picksDeleted = kept.picks;
  report.rowsDeleted = kept.rows;
  if (options.orphans) await orphans(deps, now, report);
  return report;
}

/** import-drive as a job: rounds every driveIntervalMs, the lock held for at most driveLockMs past a crash, orphans every tenth round. */
export function createDriveJob(deps: ImportDeps, lock: JobLock) {
  let rounds = 0;
  const job = createJob({
    name: "import-drive",
    intervalMs: IMPORT_RULES.driveIntervalMs,
    lockTtlMs: IMPORT_RULES.driveLockMs,
    lock,
    log: deps.log,
    run: async () => {
      rounds++;
      await driveRound(deps, deps.now(), { orphans: rounds % IMPORT_RULES.orphanEveryRounds === 1 });
    },
  });
  return { round: job.round, start: job.start };
}
