import type { MediaView } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import type { ExportedPostRow, HandleRefRow, PostRefRow } from "../repo";

/** An image on one of the exported posts, as the media module reports it; the account module names its file in the archive. */
export interface ExportedMedia {
  id: string;
  altText: string;
  width: number;
  height: number;
}

export type ExportedPost = ExportedPostRow & { media: ExportedMedia[] };

/**
 * The social module's part of the data export (1b design, section 7.5): the profile with every handle
 * it ever had, every post it wrote whatever its state, with its images, what it liked, reposted and
 * bookmarked, and the accounts it follows, blocks and mutes by the handle they have now. Times are
 * Dates here; the account module writes them as ISO text.
 */
export interface ProfileExport {
  profile: { handle: string; displayName: string; bio: string; createdAt: Date; handleHistory: string[] };
  posts: ExportedPost[];
  likes: PostRefRow[];
  reposts: PostRefRow[];
  bookmarks: PostRefRow[];
  following: HandleRefRow[];
  blocks: HandleRefRow[];
  mutes: HandleRefRow[];
}

/** Images are fetched for this many posts at a time, so an account with many posts never puts every id into one statement. */
const MEDIA_BATCH = 500;

export async function exportProfile(deps: SocialDeps, userId: string): Promise<ProfileExport> {
  const rows = await deps.repo.exportProfile(userId);
  if (!rows) throw new SocialError("not_found", 404);

  const media = new Map<string, MediaView[]>();
  for (let start = 0; start < rows.posts.length; start += MEDIA_BATCH) {
    const batch = rows.posts.slice(start, start + MEDIA_BATCH).map((post) => post.id);
    for (const [postId, views] of await deps.media.forPosts(batch)) media.set(postId, views);
  }

  // handle_history holds the handle chosen at onboarding and every one later left behind, so the current handle
  // is there only when the account went back to one it had before; the list names every handle, the current one included.
  const handleHistory = [...rows.handleHistory];
  const current = rows.profile.handle.toLowerCase();
  if (!handleHistory.includes(current)) handleHistory.push(current);

  return {
    profile: { handle: rows.profile.handle, displayName: rows.profile.displayName, bio: rows.profile.bio, createdAt: rows.profile.createdAt, handleHistory },
    posts: rows.posts.map((post) => ({
      ...post,
      media: (media.get(post.id) ?? []).map((view) => ({ id: view.id, altText: view.alt, width: view.width, height: view.height })),
    })),
    likes: rows.likes,
    reposts: rows.reposts,
    bookmarks: rows.bookmarks,
    following: rows.following,
    blocks: rows.blocks,
    mutes: rows.mutes,
  };
}
