import type { DeleteConfirmRequest, DeleteStartResponse } from "@korbat/contracts";
import type { RequestContext, Session } from "../../auth";
import type { AccountDeps } from "../context";

/** The code goes to the account's own address; that is the auth module's alone (1b design, section 7.6). */
export function startDeletion(deps: AccountDeps, session: Session, ctx: RequestContext): Promise<DeleteStartResponse> {
  return deps.auth.startDeletion(session, ctx);
}

/**
 * Steps 2 to 4 of section 7.6, for an account the auth module has marked deleted: the social purge,
 * with the image rows detached and their files asked for inside its transaction; then the forgetting
 * of the reports the account sent (3c design, section 7.10: the database acts only on an account whose
 * auth row is marked deleted, which the take-down did before any step here); then the auth row's
 * anonymisation. The files are asked for before the commit, not after it: were the process to stop
 * between a commit and the request, a rerun would find no rows left, mark the account purged and
 * leave the files to the sweeper's reconcile pass, which refuses to act on many orphans at once. A
 * request is one empty file per id, so a rerun after a failed commit, which finds the same rows again,
 * asks again for the same ids and changes nothing; the files it asked for belong to an account that is
 * being deleted either way. Every step changes only what is still there, so the purge can run again
 * after a failure, from the request or from the job, and finish what an earlier run left.
 */
export async function purge(deps: AccountDeps, userId: string): Promise<void> {
  await deps.social.purgeProfile(userId, deps.now(), async (tx) => {
    await deps.media.requestDeletion(await deps.media.purgeOwner(tx, userId));
  });
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
