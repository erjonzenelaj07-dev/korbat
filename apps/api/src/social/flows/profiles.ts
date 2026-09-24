import type { Pagination, ProfileListItem, ProfilePage, ProfileView } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import type { ProfileListRow, ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";

/** A profile by handle (a leading @ is tolerated), or not_found. Does not consider the viewer. */
export async function lookupProfile(deps: SocialDeps, handle: string): Promise<ProfileRow> {
  const profile = await deps.repo.findProfileByHandle(handle.replace(/^@/, ""));
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/** A profile the viewer may see: a block in either direction makes it not_found. */
export async function visibleProfile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (viewer && viewer !== profile.id && (await deps.repo.blockedEitherWay(viewer, [profile.id])).size > 0) {
    throw new SocialError("not_found", 404);
  }
  return profile;
}

export async function profile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileView> {
  const target = await visibleProfile(deps, viewer, handle);
  const view: ProfileView = {
    id: target.id,
    handle: target.handle,
    displayName: target.displayName,
    bio: target.bio,
    verified: target.verified,
    createdAt: target.createdAt.toISOString(),
    counts: { posts: target.postCount, followers: target.followerCount, following: target.followingCount },
  };
  if (viewer && viewer !== target.id) {
    const relation = await deps.repo.relation(viewer, target.id);
    view.viewer = { following: relation.following, followedBy: relation.followedBy, blocked: relation.blocked, muted: relation.muted };
  }
  return view;
}

/**
 * Turns list rows into profile items for a signed-in viewer, dropping accounts with a block in
 * either direction and marking which ones the viewer follows.
 */
export async function profileItems(deps: SocialDeps, viewer: string, rows: ProfileListRow[]): Promise<ProfileListItem[]> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, blocked, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.blockedEitherWay(viewer, ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (!row || blocked.has(id)) continue;
    items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return items;
}

export async function followers(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.followers(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

export async function following(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.following(target.id, viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
