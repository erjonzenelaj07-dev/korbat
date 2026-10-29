import type { BlockResponse, FollowResponse, MuteResponse, Pagination, ProfileListItem, ProfilePage } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { ProfileRow, Relation } from "../repo";
import { authorOf, pageCursor } from "../views";
import { onceMoreOnDeadlock, ownProfile } from "./posts";
import { lookupProfile } from "./profiles";

/**
 * The account a graph action targets. Never yourself. For an action, an account that blocks the
 * viewer is `not_found`, like every other read or write towards it; undoing the viewer's own block
 * or mute needs no such answer, since the viewer is looking at their own list.
 */
async function target(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<{ profile: ProfileRow; relation: Relation }> {
  const profile = await lookupProfile(deps, handle);
  if (profile.id === viewer) throw new SocialError("self_target", 400);
  const relation = await deps.repo.relation(viewer, profile.id);
  if (on && relation.blockedBy) throw new SocialError("not_found", 404);
  return { profile, relation };
}

/**
 * Follow or unfollow. Following someone you block is `blocked`; someone who blocks you is
 * `not_found`, like every other read or write towards them. Only the follow itself is limited.
 * 3e (design, section 5, the lock order, item 3): a follow or an unfollow between an account being purged and one of its
 * counterparts can cross the purge's locks; PostgreSQL ends one of the two, and the follow or unfollow, which changed
 * nothing, is run once more and then finds the purge committed. A suspended account's follow is refused account_suspended.
 */
export async function setFollow(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<FollowResponse> {
  const { profile, relation } = await target(deps, viewer, handle, on);
  if (relation.blocked) throw new SocialError("blocked", 403);
  if (relation.blockedBy) throw new SocialError("not_found", 404);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "follow", me.createdAt, deps.now());
    await onceMoreOnDeadlock(() => deps.repo.follow(viewer, profile.id, deps.now(), true));
  } else {
    await onceMoreOnDeadlock(() => deps.repo.unfollow(viewer, profile.id));
  }
  const fresh = (await deps.repo.findProfiles([profile.id])).get(profile.id)!;
  return { following: on, followerCount: fresh.followerCount };
}

/** Block or unblock. Blocking removes follows, reposts and likes in both directions; unblocking restores nothing. */
export async function setBlock(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<BlockResponse> {
  const { profile } = await target(deps, viewer, handle, on);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "block", me.createdAt, deps.now());
    await deps.repo.block(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unblock(viewer, profile.id);
  }
  return { blocked: on };
}

/** Mute or unmute. Silent: the muted account is never told and nothing else changes. */
export async function setMute(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<MuteResponse> {
  const { profile } = await target(deps, viewer, handle, on);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "mute", me.createdAt, deps.now());
    await deps.repo.mute(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unmute(viewer, profile.id);
  }
  return { muted: on };
}

async function ownList(deps: SocialDeps, viewer: string, rows: { profileId: string; sortAt: Date }[], limit: number): Promise<ProfilePage> {
  const ids = rows.map((row) => row.profileId);
  // 2d Task 3 (7.5): the page's avatars in one statement beside the profiles.
  const [profiles, followed, avatars] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.followedBy(viewer, ids), deps.media.avatarsOf(ids, viewer)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (row) items.push({ ...authorOf(row, avatars.get(id) ?? null), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return { items, nextCursor: pageCursor(rows, limit) };
}

/** The viewer's own blocked accounts, newest block first. This is where unblocking starts. */
export async function blockedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.blockedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}

export async function mutedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.mutedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}
