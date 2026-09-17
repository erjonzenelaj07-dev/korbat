import type { BlockResponse, FollowResponse, MuteResponse, Pagination, ProfileListItem, ProfilePage } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";
import { ownProfile } from "./posts";
import { lookupProfile } from "./profiles";

/** The account a graph action targets. Never yourself. */
async function target(deps: SocialDeps, viewer: string, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (profile.id === viewer) throw new SocialError("self_target", 400);
  return profile;
}

/**
 * Follow or unfollow. Following someone you block is `blocked`; someone who blocks you is
 * `not_found`, like every other read or write towards them. Only the follow itself is limited.
 */
export async function setFollow(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<FollowResponse> {
  const profile = await target(deps, viewer, handle);
  const relation = await deps.repo.relation(viewer, profile.id);
  if (relation.blocked) throw new SocialError("blocked", 403);
  if (relation.blockedBy) throw new SocialError("not_found", 404);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "follow", me.createdAt, deps.now());
    await deps.repo.follow(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unfollow(viewer, profile.id);
  }
  const fresh = (await deps.repo.findProfiles([profile.id])).get(profile.id)!;
  return { following: on, followerCount: fresh.followerCount };
}

/** Block or unblock. Blocking removes follows in both directions; unblocking restores nothing. */
export async function setBlock(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<BlockResponse> {
  const profile = await target(deps, viewer, handle);
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
  const profile = await target(deps, viewer, handle);
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
  const [profiles, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (row) items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
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
