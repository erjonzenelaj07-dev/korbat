import { MediaError, type MediaDeps } from "../context";

/**
 * Removes an upload its owner decided not to post. An image that is on a post goes with the post,
 * not through here, so anything that is not the caller's own unattached upload is simply not found.
 */
export async function remove(deps: MediaDeps, ownerId: string, id: string): Promise<void> {
  // 3d Task 7 (design, sections 5 and 7.8 step 5): while the comparison is on, an upload still processing whose check is
  // pending or capped is kept, and answered as removed: the composer forgets it, and the sweeper deletes the row once
  // finalize gave it a verdict, so nobody escapes a check by removing the upload in its seconds. Its upload file stays
  // for the worker, and no deletion is asked for.
  const removed = await deps.repo.deleteUnattached(id, ownerId, deps.match.mode !== "off");
  if (removed === "kept") return;
  if (removed === "none") throw new MediaError("not_found", 404);
  await deps.files.discardUpload(id);
  // The worker may already have written files, or be about to: the request covers both.
  await deps.files.requestDeletion([id]);
}
