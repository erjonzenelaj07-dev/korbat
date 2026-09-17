import type { EngagementResponse } from "@korbat/contracts";
import type { SocialDeps } from "../context";
import { enforceWriteLimit } from "../limits";
import { ownProfile, targetPost } from "./posts";

export type EngagementKind = "like" | "repost" | "bookmark";

/**
 * Likes, reposts and bookmarks and their undos. Doing an action twice, or undoing one that was not
 * done, changes nothing and returns the current state. Only the action itself is rate limited.
 */
export async function setEngagement(deps: SocialDeps, viewer: string, postId: string, kind: EngagementKind, on: boolean): Promise<EngagementResponse> {
  await targetPost(deps, viewer, postId);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, kind, me.createdAt, deps.now());
    if (kind === "like") await deps.repo.like(viewer, postId, deps.now());
    else if (kind === "repost") await deps.repo.repost(viewer, postId, deps.now());
    else await deps.repo.bookmark(viewer, postId, deps.now());
  } else if (kind === "like") await deps.repo.unlike(viewer, postId);
  else if (kind === "repost") await deps.repo.unrepost(viewer, postId);
  else await deps.repo.unbookmark(viewer, postId);

  const row = (await deps.repo.findPosts([postId])).get(postId)!;
  const state = (await deps.repo.viewerPostStates(viewer, [postId])).get(postId)!;
  return { counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount }, viewer: state };
}
