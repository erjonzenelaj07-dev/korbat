import { MediaFailure, type MediaStatusResponse } from "@korbat/contracts";
import { MediaError, type MediaDeps } from "../context";
import type { MediaRow } from "../repo";

/**
 * Records the worker's verdict for an upload, if there is one, and removes the upload file, which
 * is how the worker learns that its result was read. Safe to repeat: only a row that is still
 * processing changes.
 */
export async function finalize(deps: MediaDeps, id: string): Promise<boolean> {
  const result = await deps.files.readResult(id);
  if (!result) return false;
  // 3d Task 6: a ready result of version 2 may carry the scorer's model and score. The score is kept only from this
  // server's own model; another model's is dropped, with the image, which is ready all the same, left unscored. The score
  // itself is never logged.
  const r1 = result.v === 2 && result.status === "ready" ? result.r1 : undefined;
  if (r1 !== undefined && r1.model !== deps.r1Model) deps.log.error({ id, model: r1.model }, "media store: dropped a score from a model this server does not run");
  await deps.repo.finalize(id, result, r1 !== undefined && r1.model === deps.r1Model ? r1.score : null);
  await deps.files.discardUpload(id);
  return true;
}

function statusOf(row: MediaRow): MediaStatusResponse {
  if (row.status === "ready" && row.width !== null && row.height !== null) {
    // A sealed image is shown to nobody, its owner included: its status says that it is ready and how large it is, never
    // the blurhash, which is made from the image and which the repository did not hand over.
    if (row.moderationState === "sealed") return { id: row.id, status: "ready", width: row.width, height: row.height };
    if (row.blurhash !== null) return { id: row.id, status: "ready", width: row.width, height: row.height, blurhash: row.blurhash };
  }
  if (row.status === "failed") {
    const reason = MediaFailure.safeParse(row.error);
    return { id: row.id, status: "failed", error: reason.success ? reason.data : "processing_failed" };
  }
  return { id: row.id, status: "processing" };
}

/**
 * The state of one upload, for its owner only. Whoever asks first finalizes it. 3d (design, sections 7.1 and 9.6): a
 * ready image on a post whose state is visible and whose files are not in the store says `lost` when korbat recorded
 * them as lost, and `restoring` while they wait in the quarantine to be returned; the app asks this after a failed load
 * of the viewer's own image. Only then is the store looked at and the database asked.
 */
export async function status(deps: MediaDeps, ownerId: string, id: string): Promise<MediaStatusResponse> {
  let row = await deps.repo.find(id);
  if (!row || row.ownerId !== ownerId) throw new MediaError("not_found", 404);
  if (row.status === "processing" && (await finalize(deps, id))) row = (await deps.repo.find(id)) ?? row;
  const answer = statusOf(row);
  if (answer.status === "ready" && row.moderationState === "visible" && row.postId !== null && !(await deps.files.imageFilesPresent(id))) {
    const custody = await deps.repo.custody(id);
    if (custody.lost) return { ...answer, lost: true };
    if (custody.quarantined) return { ...answer, restoring: true };
  }
  return answer;
}
