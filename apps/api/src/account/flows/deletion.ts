import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { RequestContext, Session } from "../../auth";
import type { AccountDeps } from "../context";

/** The code goes to the account's own address; that is the auth module's alone (1b design, section 7.6). */
export function startDeletion(deps: AccountDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  return deps.auth.startDeletion(session, ctx);
}

/**
 * Steps 2 to 4 of section 7.6, for an account the auth module has marked deleted: the social purge,
 * with the image rows detached inside its transaction; then, once that transaction has committed, the
 * request for the files of exactly the rows it deleted; then the forgetting of the reports the account
 * sent (3c design, section 7.10: the database acts only on an account whose auth row is marked deleted,
 * which the take-down did before any step here); then the auth row's anonymisation.
 *
 * The files are asked for after the commit, never before it. A request cannot be taken back, and the
 * worker deletes whatever one names: a transaction that asked first and then did not commit left its
 * rows standing with their files on the way out, and a report of child sexual abuse material about the
 * account, which a deleted account still takes, could freeze those rows before the rerun, which then
 * keeps them: kept, sealable evidence whose images korbat itself had deleted. What the old order was
 * for (a process that stops between the commit and the request leaves files nobody asks for) the media
 * module covers: it notes inside the transaction that the files are owed, and its sweeper writes the
 * request from that note when this run could not. So a request that fails here is logged and does not
 * hold the purge back. Every step changes only what is still there, so the purge can run again after a
 * failure, from the request or from the job, and finish what an earlier run left.
 */
export async function purge(deps: AccountDeps, userId: string): Promise<void> {
  let images: string[] = [];
  await deps.social.purgeProfile(userId, deps.now(), async (tx) => {
    images = await deps.media.purgeOwner(tx, userId);
  });
  try {
    await deps.media.requestDeletion(images);
  } catch (err) {
    deps.log.error({ err, userId, count: images.length }, "account purge: the files of the deleted images could not be requested now; the media sweeper asks again");
  }
  // After the profile is marked deleted and before the account counts as purged: a failure here leaves the purge pending,
  // and its rerun, like every step's, changes nothing that is already done.
  await deps.moderation?.forgetAccount(userId);
  await deps.auth.finishPurge(userId);
}

/**
 * The auth module checks the handle and the code and takes the account down (step 1); from there the
 * account is gone whatever happens next. The purge runs here so the owner's request answers only once
 * their posts and images are gone (seconds, for a large account). Should it fail, the failure is logged
 * and the request still succeeds: the purge job finishes any deletion left half done within five minutes.
 */
export async function confirmDeletion(deps: AccountDeps, session: Session, input: DeleteConfirmRequest): Promise<void> {
  await deps.auth.confirmDeletion(session, input);
  try {
    await purge(deps, session.userId);
  } catch (err) {
    deps.log.error({ err, userId: session.userId }, "account deletion: the purge failed after the confirmation; the purge job will finish it");
  }
}
