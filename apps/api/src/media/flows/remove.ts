import { MediaError, type MediaDeps } from "../context";

/**
 * Removes an upload its owner decided not to post. An image that is on a post goes with the post,
 * not through here, so anything that is not the caller's own unattached upload is simply not found.
 */
export async function remove(deps: MediaDeps, ownerId: string, id: string): Promise<void> {
  if (!(await deps.repo.deleteUnattached(id, ownerId))) throw new MediaError("not_found", 404);
  await deps.files.discardUpload(id);
  // The worker may already have written files, or be about to: the request covers both.
  await deps.files.requestDeletion([id]);
}
