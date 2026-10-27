import type { SocialDeps } from "../context";
import type { ImportBatchJob, ImportBatchPost, ImportBatchResult } from "../repo";

/**
 * The social module's two batch writers for the imports module (3b design, sections 6.5 and 9.1): posts are written only
 * by this module, and their images only through the media module's interface for posts, inside this module's
 * transaction. The imports module decides which lines a choice keeps and what each post holds (imports/plan.ts); these
 * write them, or tombstone them, and nothing else.
 */

/** One batch of an import's posts, its kept images attached with their descriptions (decision 20). */
export function publishImportedBatch(deps: Pick<SocialDeps, "repo" | "media">, job: ImportBatchJob, batch: { lines: number; posts: readonly ImportBatchPost[] }, now: Date): Promise<ImportBatchResult> {
  return deps.repo.publishImportedBatch(job, batch, now, (tx, input) => deps.media.attach(tx, input));
}

/**
 * One batch of an import's undo, through the author's own deletion path: the images of each tombstoned post detached in
 * the transaction, where the keep trigger leaves every image a case holds or a frozen post owns, and the files of the rows
 * that went asked for after the commit, as the author's deletion asks for them (flows/posts.ts): files cannot be rolled
 * back. The media module notes nothing owed here; a request lost to a crash leaves files no row names, which its
 * reconciliation finds.
 */
export async function removeImportedBatch(deps: Pick<SocialDeps, "repo" | "media">, job: { id: string; ownerId: string }, now: Date, limit: number): Promise<{ selected: number; removed: number }> {
  const result = await deps.repo.removeImportedBatch(job, now, limit, (tx, postId) => deps.media.detachAll(tx, postId));
  await deps.media.requestDeletion(result.images);
  return { selected: result.selected, removed: result.removed };
}
