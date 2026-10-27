import path from "node:path";
import { ImportMediaFile, MEDIA_MAX_PER_POST } from "@korbat/contracts";

const IMPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE_EXTENSIONS = ["jpg", "png", "webp"] as const;
export type ImportImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/** Ids are lowercase UUIDs made by the API (import_jobs.id). Nothing else may become part of a path. */
export function isImportId(value: string): boolean {
  return IMPORT_ID.test(value);
}

/** The only names the work folder's media/ may hold, by the contracts' ImportMediaFile. */
export function isImportMediaFile(value: string): boolean {
  return ImportMediaFile.safeParse(value).success;
}

function checked(id: string): string {
  if (!isImportId(id)) throw new Error("not an import id");
  return id;
}

function checkedFile(file: string): string {
  if (!isImportMediaFile(file)) throw new Error("not an import media file");
  return file;
}

/** The name the importer's core gives the image at `position` (from 0) of line `ref`. Throws for any other. */
export function mediaFileName(ref: number, position: number, extension: ImportImageExtension): string {
  if (!Number.isInteger(position) || position < 0 || position >= MEDIA_MAX_PER_POST || !IMAGE_EXTENSIONS.includes(extension)) throw new Error("not an import media file");
  return checkedFile(`${ref}-${position}.${extension}`);
}

/**
 * The archives volume, import-archives: the API writes it, the importer only reads it (3b design, section 7.1).
 *   jobs/<id>/archive.part   the archive while chunks arrive
 *   jobs/<id>/archive        the complete archive
 *   jobs/<id>/job.json       { v: 1, id, source, accountKey, images, createdAt }
 *   queue/<id>               the API's marker: this archive waits for a scan (oldest mtime first)
 *   delete/<id>              the API's request: delete the work folder of <id>, and stop scanning it
 */
export function archivesLayout(root: string) {
  const jobs = path.join(root, "jobs");
  const queue = path.join(root, "queue");
  const deletions = path.join(root, "delete");
  const jobDir = (id: string) => path.join(jobs, checked(id));
  return {
    root,
    jobs,
    queue,
    deletions,
    jobDir,
    part: (id: string) => path.join(jobDir(id), "archive.part"),
    archive: (id: string) => path.join(jobDir(id), "archive"),
    job: (id: string) => path.join(jobDir(id), "job.json"),
    queued: (id: string) => path.join(queue, checked(id)),
    deletion: (id: string) => path.join(deletions, checked(id)),
  };
}
export type ArchivesLayout = ReturnType<typeof archivesLayout>;

/**
 * The work volume, import-work: the importer writes it, the API only reads it, and every read goes through openWorkFile.
 *   jobs/<id>/scratch        the scan's scratch file, deleted when the scan ends
 *   jobs/<id>/posts.jsonl    one ImportedPost a line, in date order
 *   jobs/<id>/media/<file>   allowlisted images of kept posts, named <ref>-<position>.<jpg|png|webp>
 *   jobs/<id>/summary.json   the commit point, written last (ImportSummary)
 *   attempts/<id>            how often a scan of <id> started
 *   tmp/                     files being written; renamed into place
 *   heartbeat                rewritten every ten seconds
 */
export function workLayout(root: string) {
  const jobs = path.join(root, "jobs");
  const attempts = path.join(root, "attempts");
  const tmp = path.join(root, "tmp");
  const jobDir = (id: string) => path.join(jobs, checked(id));
  const mediaDir = (id: string) => path.join(jobDir(id), "media");
  return {
    root,
    jobs,
    attempts,
    tmp,
    heartbeat: path.join(root, "heartbeat"),
    jobDir,
    scratch: (id: string) => path.join(jobDir(id), "scratch"),
    posts: (id: string) => path.join(jobDir(id), "posts.jsonl"),
    mediaDir,
    media: (id: string, file: string) => path.join(mediaDir(id), checkedFile(file)),
    summary: (id: string) => path.join(jobDir(id), "summary.json"),
    attempt: (id: string) => path.join(attempts, checked(id)),
  };
}
export type WorkLayout = ReturnType<typeof workLayout>;
