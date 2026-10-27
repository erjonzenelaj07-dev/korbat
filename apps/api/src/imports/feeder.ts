import { IMPORT_RULES, ImportChoice, MEDIA_MAX_BYTES, type ImportImageSkip } from "@korbat/contracts";
import type { ImportImageRow } from "../media";
import type { ImportDeps } from "./context";
import { endFiles } from "./flows/end";
import { buildPlan, importImageId, refusedPost, type ImportPlan, type PlannedImage } from "./plan";
import type { PreparingImport } from "./repo";
import { scanOf } from "./view";

/**
 * The feeder (3b design, sections 7.4 and 8.2; decisions 17 to 19), a step of import-drive for the one import in preparing
 * confirmed longest ago: one import is fed at a time. The worker is not changed: the feeder puts an imported image into
 * media-uploads/incoming/ through the media module's own receive path only while no upload of anyone's own waits there
 * for the worker, while fewer than IMPORT_RULES.imagesInFlight imported images are processing without a result on the
 * site, and within IMPORT_IMAGES_PER_HOUR counted in the limit store under import-images-site (a store that cannot count
 * feeds nothing), so a person's own upload waits behind at most two imported images.
 *
 * Each round it first finalizes its images still processing and settles each of its rows: ready with a clear check is
 * kept; ready with a match that does not act (no refusal names it) is left out as flagged, never published, and an admin
 * is alerted; failed is left out; one still unchecked, capped or never answered IMPORT_RULES.checkHours after its row was
 * written is left out as not_checked (decision 19, and for a file that never reached the worker the orchestrator's ruling).
 * A row left out is deleted as it settles, in the transaction that counts it, so no settled image changes its count; a
 * refusal stops the import before any post (8.2). Once the cursor has passed every planned image and every row left is
 * kept, the import moves to publishing. Images are imported only while a matcher is (decision 15): with the comparison off,
 * every image not yet fed is left out as not_checked.
 */

/** What a round of the feeder did, for import-drive's report. */
export interface FeedReport {
  fed: number;
  /** Images left out before a row was written (missing_file, unsupported, too_large, not_checked while the matcher is off). */
  skipped: number;
  /** Rows settled as left out, and the flagged among them. */
  leftOut: number;
  flagged: number;
  /** The import stopped on a refused image, or moved to publishing. */
  refused: boolean;
  published: boolean;
}

/** The limit store's key of the site's pace (7.6). */
export const IMAGES_SITE_KEY = "import-images-site";
const HOUR_MS = 3_600_000;

/** A row's settlement: kept, left out for a reason, or not settled yet. A refused row stops the import before this is asked. */
export function settlementOf(row: ImportImageRow, now: Date): "kept" | ImportImageSkip | null {
  if (row.status === "ready" && row.check === "clear") return "kept";
  // A match that acts is refused (the caller stops the import first); one that does not act is flagged, never published.
  if (row.status === "ready" && row.check === "matched") return "flagged";
  if (row.status === "failed") return "failed";
  if (now.getTime() - row.createdAt.getTime() >= IMPORT_RULES.checkHours * HOUR_MS) return "not_checked";
  return null;
}

/** The import's plan, from the process's cache or built now; null when posts.jsonl cannot be read (the import waits). */
async function planOf(deps: ImportDeps, job: PreparingImport): Promise<ImportPlan | null> {
  const cached = deps.plans.get(job.id);
  if (cached) return cached;
  const scan = scanOf(job);
  const choice = ImportChoice.safeParse(job.choice);
  if (scan === null || !choice.success) {
    deps.log.error({ id: job.id, phase: "feeder" }, "import: a preparing import's scan or choice does not parse");
    return null;
  }
  const built = await buildPlan({
    id: job.id,
    files: deps.files,
    createdAt: job.createdAt,
    fromRef: scan.fromRef,
    choice: choice.data,
    picks: await deps.repo.picks(job.id),
    images: job.images && choice.data.images,
    known: (keys) => deps.social.importedKeys(job.ownerId, keys),
  });
  if (!built.ok) {
    deps.log.error({ id: job.id, phase: "feeder", code: built.code }, "import: posts.jsonl was refused while planning the images");
    return null;
  }
  deps.plans.set(job.id, built.plan);
  deps.log.info({ id: job.id, phase: "feeder", images: built.plan.images.length }, "import: images planned");
  return built.plan;
}

/** Plans of imports that left preparing (a stop, a time limit, an admin's end, the move to publishing) are dropped. */
async function prunePlans(deps: ImportDeps): Promise<void> {
  if (deps.plans.size === 0) return;
  const statuses = await deps.repo.statuses([...deps.plans.keys()]);
  for (const id of [...deps.plans.keys()]) if (statuses.get(id) !== "preparing") deps.plans.delete(id);
}

/** 8.2: the first refusal stops the import, its other rows and its work folder go, and nothing of it was published. */
async function stopOnRefusal(deps: ImportDeps, job: PreparingImport, plan: ImportPlan, refusedId: string): Promise<boolean> {
  const image: PlannedImage | undefined = plan.images.find((planned) => importImageId(job.seed, planned.ref, planned.position) === refusedId);
  // The post's day and first words are read from the work line before the folder goes; a line that cannot be read again
  // leaves both unset, and the screen then names no post.
  const post = image === undefined ? null : await refusedPost(deps.files, job.id, image);
  const gone = await deps.repo.stopRefused(job.id, post, (tx) => deps.media.deleteImportLeftovers(tx, job.id));
  if (gone === null) return false;
  deps.plans.delete(job.id);
  await deps.media.releaseFiles(gone);
  await endFiles(deps, job.id);
  deps.log.warn({ id: job.id, phase: "stopped", reason: "refused_image", deleted: gone.length }, "import: stopped by a refused image");
  return true;
}

/** One round of the feeder at `now`; null when no import prepares. */
export async function feedRound(deps: ImportDeps, now: Date): Promise<FeedReport | null> {
  await prunePlans(deps);
  const job = await deps.repo.preparing();
  if (!job) return null;
  const report: FeedReport = { fed: 0, skipped: 0, leftOut: 0, flagged: 0, refused: false, published: false };
  const plan = await planOf(deps, job);
  if (plan === null) return report;

  // Settling: finalize what the worker answered, then judge every row on no post.
  const rows = await deps.media.settleRows(job.id);
  const refused = rows.find((row) => row.refused);
  if (refused) {
    report.refused = await stopOnRefusal(deps, job, plan, refused.id);
    return report;
  }
  let kept = 0;
  let waiting = 0;
  const leftOut = new Map<string, ImportImageSkip>();
  for (const row of rows) {
    const settled = settlementOf(row, now);
    if (settled === "kept") kept++;
    else if (settled === null) waiting++;
    else leftOut.set(row.id, settled);
  }
  if (leftOut.size > 0 || kept > job.imagesKept) {
    const gone = await deps.repo.settle(job.id, kept, leftOut, (tx, ids) => deps.media.deleteImportLeftovers(tx, job.id, ids));
    if (gone === null) return report;
    await deps.media.releaseFiles(gone);
    report.leftOut = gone.length;
    report.flagged = gone.filter((id) => leftOut.get(id) === "flagged").length;
    waiting += leftOut.size - gone.length;
    // After the commit, to every staff account: counts and a time, never an image (8.1).
    if (report.flagged > 0) await deps.moderation.imagesFlagged({ importId: job.id, count: report.flagged, at: now });
  }

  let cursor = job.imageCursor;
  // Decision 15: no image is fed while no matcher checks it. What was not fed yet is left out, and the import goes on.
  if (!deps.media.matching && cursor < plan.images.length) {
    const rest = plan.images.length - cursor;
    if (!(await deps.repo.skipImages(job.id, cursor, rest, "not_checked"))) return report;
    report.skipped += rest;
    cursor += rest;
  }

  while (cursor < plan.images.length) {
    if (await deps.media.ownUploadWaiting()) break;
    if ((await deps.media.importedInFlight()) >= IMPORT_RULES.imagesInFlight) break;
    if (!(await deps.media.hasRoom())) break;
    const image = plan.images[cursor]!;
    const opened = await deps.files.openWork(deps.files.work.media(job.id, image.file), MEDIA_MAX_BYTES);
    if (!opened.ok) {
      // The importer's output is hostile: a symlink, a folder that is a link, a file of another device or a swapped one is
      // never read, and is left out as missing, as the intake counts it.
      deps.log.warn({ id: job.id, phase: "feeder", code: opened.code }, "import: an image's work file was refused (missing_file)");
      if (!(await deps.repo.skipImages(job.id, cursor, 1, "missing_file"))) return report;
      report.skipped++;
      cursor++;
      continue;
    }
    let receipt: Awaited<ReturnType<ImportDeps["media"]["receive"]>>;
    try {
      // The site's pace, counted only for an image the worker will be given; a store that cannot count feeds nothing.
      let hit: { count: number };
      try {
        hit = await deps.limits.hit(IMAGES_SITE_KEY, HOUR_MS);
      } catch {
        deps.log.warn({ id: job.id, phase: "feeder" }, "import: the limit store could not count the site's pace; nothing is fed");
        break;
      }
      if (hit.count > deps.settings.imagesPerHour) break;
      const from = cursor;
      receipt = await deps.media.receive({
        id: importImageId(job.seed, image.ref, image.position),
        ownerId: job.ownerId,
        file: opened.file,
        now,
        importJob: { id: job.id, claim: (tx) => deps.repo.claimImage(tx, job.id, job.ownerId, from) },
      });
    } finally {
      await opened.file.handle.close();
    }
    if (receipt === "fed") {
      report.fed++;
      cursor++;
      continue;
    }
    // A row of that id exists already and is settled in a later round, as a fed one is.
    if (receipt === "already") waiting++;
    // The import moved on, or its owner's suspension runs: nothing was written, and the import waits for the next round.
    if (receipt === "stopped" || receipt === "suspended") return report;
    // A sniff or a size the media module refuses is never retried; an id fed before is passed over without a count of its own.
    const reason = receipt === "already" ? null : receipt;
    if (!(await deps.repo.skipImages(job.id, cursor, 1, reason))) return report;
    if (reason !== null) report.skipped++;
    cursor++;
  }

  // Every planned image handed over and every row left kept: the import publishes (7.5 step 4). An image fed in this round
  // has not settled yet, so its round never publishes.
  if (cursor >= plan.images.length && waiting === 0 && report.fed === 0 && (await deps.repo.toPublishing(job.id, cursor, kept))) {
    deps.plans.delete(job.id);
    report.published = true;
    deps.log.info({ id: job.id, phase: "publishing", kept }, "import: images settled; publishing");
  }
  return report;
}
