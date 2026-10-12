import path from "node:path";
import type { MediaSize } from "@korbat/contracts";

const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ids are lowercase UUIDs made by the API. Nothing else may become part of a path. */
export function isMediaId(value: string): boolean {
  return MEDIA_ID.test(value);
}

function checked(id: string): string {
  if (!isMediaId(id)) throw new Error("not a media id");
  return id;
}

/**
 * The uploads volume: the API writes it, the worker only reads it.
 *   tmp/<id>.part     a body being received
 *   incoming/<id>     a complete upload waiting for the worker
 *   delete/<id>       a request to delete image <id>
 *   delete-owed/<id>  the API's own note that a request for image <id> is owed: written inside the transaction that
 *                     deletes the image's row, and removed once the request stands. The worker never reads it, so a
 *                     transaction that does not commit has asked for nothing.
 */
export function uploadsLayout(root: string) {
  const tmp = path.join(root, "tmp");
  const incoming = path.join(root, "incoming");
  const deletions = path.join(root, "delete");
  const owed = path.join(root, "delete-owed");
  return {
    root,
    tmp,
    incoming,
    deletions,
    owed,
    part: (id: string) => path.join(tmp, `${checked(id)}.part`),
    upload: (id: string) => path.join(incoming, checked(id)),
    deletion: (id: string) => path.join(deletions, checked(id)),
    owedDeletion: (id: string) => path.join(owed, checked(id)),
  };
}
export type UploadsLayout = ReturnType<typeof uploadsLayout>;

/**
 * The store volume: the worker writes it, the API only reads it.
 *   files/<aa>/<id>/small.webp, large.webp   <aa> = the id's first two characters
 *   results/<id>.json                        the outcome, written last
 *   attempts/<id>                            how often processing started
 *   tmp/                                     files being written
 *   heartbeat                                rewritten every ten seconds
 */
export function storeLayout(root: string) {
  const files = path.join(root, "files");
  const results = path.join(root, "results");
  const attempts = path.join(root, "attempts");
  const tmp = path.join(root, "tmp");
  const imageDir = (id: string) => path.join(files, checked(id).slice(0, 2), id);
  return {
    root,
    files,
    results,
    attempts,
    tmp,
    heartbeat: path.join(root, "heartbeat"),
    shard: (id: string) => path.join(files, checked(id).slice(0, 2)),
    imageDir,
    image: (id: string, size: MediaSize) => path.join(imageDir(id), `${size}.webp`),
    result: (id: string) => path.join(results, `${checked(id)}.json`),
    attempt: (id: string) => path.join(attempts, checked(id)),
  };
}
export type StoreLayout = ReturnType<typeof storeLayout>;

/** `<id>.json` to `<id>`, or null when the name is not a result file. */
export function resultFileId(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const id = name.slice(0, -".json".length);
  return isMediaId(id) ? id : null;
}
