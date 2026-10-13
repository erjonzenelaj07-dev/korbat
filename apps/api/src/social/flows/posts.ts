import type { CreatePostRequest, Pagination, PostView, ThreadResponse } from "@korbat/contracts";
import { isDeadlock } from "../../lib/lock-bounds";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { PostRow, ProfileRow } from "../repo";
import { isTombstone, loadPostViews, pageCursor, postView, postViews } from "../views";
import { postAccess } from "../visibility";

/** The viewer's own profile row; the tiers need its creation time. */
export async function ownProfile(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const profile = (await deps.repo.findProfiles([viewer])).get(viewer);
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/**
 * A post the viewer wants to act on. The post's own state is judged first, so someone probing ids
 * learns nothing about hidden or deleted posts from a block. Then the refusal is directional: when
 * the viewer blocked the author it is `blocked`; when the author blocked the viewer it is
 * `hiddenCode`, which reveals nothing.
 */
export async function targetPost(deps: SocialDeps, viewer: string, id: string, hiddenCode: "not_found" | "post_unavailable" = "not_found"): Promise<PostRow> {
  const hidden = () => new SocialError(hiddenCode, hiddenCode === "not_found" ? 404 : 400);
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw hidden();
  if (postAccess(viewer, row, false) !== "shown") throw hidden();
  if (row.authorId !== viewer) {
    const relation = await deps.repo.relation(viewer, row.authorId);
    if (relation.blocked) throw new SocialError("blocked", 403);
    if (relation.blockedBy) throw hidden();
  }
  return row;
}

/**
 * A post, a reply or a quote by the viewer. 3e (design, section 5, the lock order, item 3): the repository takes the
 * author's row before the replied-to or quoted author's, and a purge takes its own row before its followers'; a quote of
 * the purged account's post by one of its followers can cross that purge, and PostgreSQL ends one of the two. The post's
 * transaction then changed nothing, so it is run once more: the second try finds the purge committed and answers as for
 * any deleted account. A second deadlock is the caller's.
 */
export async function createPost(deps: SocialDeps, viewer: string, input: CreatePostRequest): Promise<PostView> {
  const me = await ownProfile(deps, viewer);
  const action = input.replyToId ? "reply" : input.quoteOfId ? "quote" : "post";
  const targetId = input.replyToId ?? input.quoteOfId;
  const target = targetId ? await targetPost(deps, viewer, targetId, "post_unavailable") : null;
  await enforceWriteLimit(deps.limits, viewer, action, me.createdAt, deps.now());
  const write = () =>
    deps.repo.createPost({
      authorId: viewer,
      body: input.body,
      replyToId: input.replyToId ?? null,
      quoteOfId: input.quoteOfId ?? null,
      now: deps.now(),
      lockWith: target && target.authorId !== viewer ? target.authorId : null,
      within: (tx, postId) => deps.media.attach(tx, { postId, ownerId: viewer, items: input.media }),
    });
  const id = await onceMoreOnDeadlock(write);
  return (await postView(deps, viewer, id))!;
}

/** Runs a write, and once more when the database chose it to give way in a deadlock: it changed nothing (3e design, section 5). */
export async function onceMoreOnDeadlock<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!isDeadlock(err)) throw err;
    return write();
  }
}

export async function getPost(deps: SocialDeps, viewer: ViewerId, id: string): Promise<PostView> {
  const view = await postView(deps, viewer, id);
  if (!view) throw new SocialError("not_found", 404);
  return view;
}

/** Author only. Deleting twice is a no-op. Someone who may not see the post learns nothing. */
export async function deletePost(deps: SocialDeps, viewer: string, id: string): Promise<void> {
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw new SocialError("not_found", 404);
  if (row.authorId === viewer) {
    // The image rows go with the post, in its transaction. Their files are deleted after the commit: files cannot be rolled back.
    // The media module answers only the rows that are gone: an image a case holds as evidence, and every image of a frozen
    // post, keeps its row, served to nobody, and no deletion is asked for its files.
    let images: string[] = [];
    const remove = () =>
      deps.repo.deletePost(id, viewer, deps.now(), async (tx) => {
        images = await deps.media.detachAll(tx, id);
      });
    try {
      await remove();
    } catch (err) {
      // The deletion takes its posts in the order a report takes them, so the two never deadlock. An account's purge
      // still writes the counters of other accounts' posts in no order (its own comment says so), and the database may
      // end this transaction to break such a cycle. It has then changed nothing, so it is run once more: the author who
      // takes content down is not answered with an error for a wait that is over. A second deadlock is the caller's.
      if (!isDeadlock(err)) throw err;
      images = [];
      await remove();
    }
    await deps.media.requestDeletion(images);
    return;
  }
  const blocked = (await deps.repo.blockedEitherWay(viewer, [row.authorId])).has(row.authorId);
  if (postAccess(viewer, row, blocked) !== "shown") throw new SocialError("not_found", 404);
  throw new SocialError("not_author", 403);
}

/** The post, its ancestors root first (tombstones where needed), and a page of direct replies oldest first. */
export async function thread(deps: SocialDeps, viewer: ViewerId, id: string, query: Pagination): Promise<ThreadResponse> {
  const post = await getPost(deps, viewer, id);
  const ancestorIds = await deps.repo.ancestorIds(id);
  const loaded = await loadPostViews(deps, viewer, ancestorIds);
  const ancestors = ancestorIds.map((ancestorId) => loaded.get(ancestorId)!);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await deps.repo.replies(id, viewer, cursor, query.limit);
  const items = await postViews(deps, viewer, rows);
  return { ancestors: ancestors.map((a) => (isTombstone(a) ? a : a)), post, replies: { items, nextCursor: pageCursor(rows, query.limit) } };
}
