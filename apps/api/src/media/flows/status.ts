import { MediaFailure, type MediaStatusResponse } from "@korbat/contracts";
import { MediaError, type MediaDeps } from "../context";
import { askSource, storeVerdict, tellMatched } from "../match";
import type { MediaRow } from "../repo";

/**
 * Records the worker's verdict for an upload, if there is one, and removes the upload file, which
 * is how the worker learns that its result was read. Safe to repeat: only a row that is still
 * processing changes.
 *
 * 3d Task 7 (design, section 7.8 step 3): while the comparison with known material is on and the upload has hashes, a ready
 * verdict is stored only with its check: the source is asked once, bounded in time, and its answer is written in the
 * verdict's transaction (clear, unchecked, or matched with its record and, for an acting match, its refusal and hold). So
 * an image is ready only once its check was answered or timed out, and an upload with an acting match is never ready
 * without its refusal. Over the limit on refusals an hour the row stays processing with its check capped and its upload
 * file and result kept, for match-retry to ask again. After the commit the moderation module is told what was stored.
 */
export async function finalize(deps: MediaDeps, id: string): Promise<boolean> {
  const result = await deps.files.readResult(id);
  if (!result) return false;
  // 3d Task 6: a ready result of version 2 may carry the scorer's model and score. The score is kept only from this
  // server's own model; another model's is dropped, with the image, which is ready all the same, left unscored. The score
  // itself is never logged. 2d Task 3: version 3 carries them as version 2 does, and its avatar mark, which both writers of
  // the verdict (repo.finalize and storeVerdict) hold against the row's kind.
  const r1 = (result.v === 2 || result.v === 3) && result.status === "ready" ? result.r1 : undefined;
  if (r1 !== undefined && r1.model !== deps.r1Model) deps.log.error({ id, model: r1.model }, "media store: dropped a score from a model this server does not run");
  const score = r1 !== undefined && r1.model === deps.r1Model ? r1.score : null;
  // 3d review L3: a ready result without a score while this server's check is on: the worker does not score (it was left
  // behind, or set otherwise). The image is ready, unscored, and the operator is told here and by automation-status.
  if (deps.r1Model !== null && result.status === "ready" && r1 === undefined) deps.log.warn({ id }, "media store: a ready result carries no score while the R1 check is on; the worker does not score");
  const hashed = deps.match.mode !== "off" && result.status === "ready" ? await deps.matches.hashed(deps.matches.db, id) : null;
  if (hashed !== null && hashed.status === "processing") {
    const answer = await askSource(deps, hashed);
    const stored = await storeVerdict(deps, id, result, score, hashed, answer);
    // A capped upload keeps its upload file, so the worker keeps its result for the next question.
    if (stored.stored !== "capped") await deps.files.discardUpload(id);
    await tellMatched(deps, stored.events);
    return true;
  }
  await deps.repo.finalize(id, result, score);
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
 *
 * 3d Task 7 (design, sections 7.8 step 5 and 10.2): an upload korbat refused answers `refused` with the refusal's id and
 * nothing else, no blurhash and no size, also once its row is gone; one whose check is capped answers processing and is
 * left to match-retry, so a composer's polling never asks the source again.
 */
export async function status(deps: MediaDeps, ownerId: string, id: string): Promise<MediaStatusResponse> {
  const refusalId = await deps.matches.refusalOfImage(id, ownerId);
  if (refusalId !== null) return { id, status: "refused", refusalId };
  let row = await deps.repo.find(id);
  if (!row || row.ownerId !== ownerId) throw new MediaError("not_found", 404);
  if (row.status === "processing" && !(await deps.matches.capped([id])).has(id) && (await finalize(deps, id))) {
    const refused = await deps.matches.refusalOfImage(id, ownerId);
    if (refused !== null) return { id, status: "refused", refusalId: refused };
    row = (await deps.repo.find(id)) ?? row;
  }
  const answer = statusOf(row);
  if (answer.status === "ready" && row.moderationState === "visible" && row.postId !== null && !(await deps.files.imageFilesPresent(id))) {
    const custody = await deps.repo.custody(id);
    if (custody.lost) return { ...answer, lost: true };
    if (custody.quarantined) return { ...answer, restoring: true };
  }
  return answer;
}
