import type { Pagination, PostPage, TimelinePage } from "@korbat/contracts";
import type { SocialDeps, ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { pageCursor, postViews, timelineItems } from "../views";
import { visibleProfile } from "./profiles";

const cursorOf = (query: Pagination) => (query.cursor ? decodeCursor(query.cursor) : undefined);

/** Top-level posts, quotes and reposts from followed accounts and the viewer, newest first. */
export async function followingTimeline(deps: SocialDeps, viewer: string, query: Pagination): Promise<TimelinePage> {
  const rows = await deps.repo.followingTimeline(viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** Every visible top-level post and quote, newest first. Public; a signed-in viewer's blocks and mutes apply. */
export async function latestTimeline(deps: SocialDeps, viewer: ViewerId, query: Pagination): Promise<TimelinePage> {
  const rows = await deps.repo.latestTimeline(viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Posts tab: its top-level posts, quotes and reposts. */
export async function profilePosts(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<TimelinePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profilePosts(target.id, viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Replies tab, newest first. */
export async function profileReplies(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<PostPage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profileReplies(target.id, viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own likes, newest like first. */
export async function likedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.likedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own bookmarks, newest bookmark first. */
export async function bookmarkedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.bookmarkedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
