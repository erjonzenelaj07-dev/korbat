import type { EngagementResponse } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { enforceWriteLimit } from "../limits";
import { countsFor } from "../views";
import { ownProfile, targetPost } from "./posts";

export type EngagementKind = "like" | "repost" | "bookmark";

/**
 * Likes, reposts and bookmarks and their undos. Doing an action twice, or undoing one that was not
 * done, changes nothing and returns the current state. Only the action itself is rate limited, and
 * only the action consults the block relation: an undo removes the viewer's own row, whatever
 * stands between the accounts by then.
 */
export async function setEngagement(deps: SocialDeps, viewer: string, postId: string, kind: EngagementKind, on: boolean): Promise<EngagementResponse> {
  if (on) {
    const target = await targetPost(deps, viewer, postId);
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, kind, me.createdAt, deps.now());
    const other = target.authorId === viewer ? undefined : target.authorId;
    if (kind === "like") await deps.repo.like(viewer, postId, deps.now(), other);
    else if (kind === "repost") await deps.repo.repost(viewer, postId, deps.now(), other);
    else await deps.repo.bookmark(viewer, postId, deps.now());
  } else if (kind === "like") await deps.repo.unlike(viewer, postId);
  else if (kind === "repost") await deps.repo.unrepost(viewer, postId);
  else await deps.repo.unbookmark(viewer, postId);

  const row = (await deps.repo.findPosts([postId])).get(postId);
  if (!row) throw new SocialError("not_found", 404);
  const state = (await deps.repo.viewerPostStates(viewer, [postId])).get(postId)!;
  // 2d (9.3): the answer's counts follow the views' one rule, so liking a post whose counts are hidden tells nothing.
  return { counts: countsFor(viewer, row), viewer: state };
}
