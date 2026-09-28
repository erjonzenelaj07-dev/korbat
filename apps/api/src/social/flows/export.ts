import type { MediaView } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import type { ExportKey, ExportPage, ExportedPostRow, HandleRefRow, PostRefRow } from "../repo";

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
 * it ever had and its Explore switch (2c design, section 8), every post it wrote whatever its state,
 * with its images, what it liked, reposted and bookmarked, and the accounts it follows, blocks and
 * mutes by the handle they have now. Times are Dates here; the account module writes them as ISO text.
 *
 * The profile is read at once; each list is read page by page while the account module writes it, so
 * an account with many rows never has them all in memory. A list can be iterated more than once; each
 * iteration reads it again from the start.
 */
export interface ProfileExport {
  profile: { handle: string; displayName: string; bio: string; createdAt: Date; handleHistory: string[]; showInExplore: boolean };
  posts: AsyncIterable<ExportedPost[]>;
  likes: AsyncIterable<PostRefRow[]>;
  reposts: AsyncIterable<PostRefRow[]>;
  bookmarks: AsyncIterable<PostRefRow[]>;
  following: AsyncIterable<HandleRefRow[]>;
  blocks: AsyncIterable<HandleRefRow[]>;
  mutes: AsyncIterable<HandleRefRow[]>;
}

/** Rows per page of an export list: one statement each, and at most this many rows of a list in memory at once. */
export const EXPORT_PAGE_SIZE = 1_000;

/**
 * A list read in keyset pages, in (created_at, id) order: each page starts after the key of the last row
 * of the page before, and is read only once that page has been used. The walk ends at a page that is not
 * full.
 */
function paged<T>(read: (after: ExportKey | null) => Promise<ExportPage<T>>): AsyncIterable<T[]> {
  return {
    async *[Symbol.asyncIterator]() {
      let after: ExportKey | null = null;
      do {
        const page: ExportPage<T> = await read(after);
        if (page.rows.length > 0) yield page.rows;
        after = page.next;
      } while (after !== null);
    },
  };
}

/** Each page of posts with its images, fetched from the media module for that page's posts only. */
function withMedia(deps: SocialDeps, pages: AsyncIterable<ExportedPostRow[]>): AsyncIterable<ExportedPost[]> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const rows of pages) {
        const media: Map<string, MediaView[]> = await deps.media.forPosts(rows.map((post) => post.id));
        yield rows.map((post) => ({
          ...post,
          media: (media.get(post.id) ?? []).map((view) => ({ id: view.id, altText: view.alt, width: view.width, height: view.height })),
        }));
      }
    },
  };
}

export async function exportProfile(deps: SocialDeps, userId: string, pageSize: number = EXPORT_PAGE_SIZE): Promise<ProfileExport> {
  const head = await deps.repo.exportHead(userId);
  if (!head) throw new SocialError("not_found", 404);

  // handle_history holds the handle chosen at onboarding and every one later left behind, so the current handle
  // is there only when the account went back to one it had before; the list names every handle, the current one included.
  const handleHistory = [...head.handleHistory];
  const current = head.profile.handle.toLowerCase();
  if (!handleHistory.includes(current)) handleHistory.push(current);

  return {
    profile: {
      handle: head.profile.handle,
      displayName: head.profile.displayName,
      bio: head.profile.bio,
      createdAt: head.profile.createdAt,
      handleHistory,
      showInExplore: head.showInExplore,
    },
    posts: withMedia(
      deps,
      paged((after) => deps.repo.exportPosts(userId, after, pageSize)),
    ),
    likes: paged((after) => deps.repo.exportPostRefs(userId, "likes", after, pageSize)),
    reposts: paged((after) => deps.repo.exportPostRefs(userId, "reposts", after, pageSize)),
    bookmarks: paged((after) => deps.repo.exportPostRefs(userId, "bookmarks", after, pageSize)),
    following: paged((after) => deps.repo.exportHandleRefs(userId, "follows", after, pageSize)),
    blocks: paged((after) => deps.repo.exportHandleRefs(userId, "blocks", after, pageSize)),
    mutes: paged((after) => deps.repo.exportHandleRefs(userId, "mutes", after, pageSize)),
  };
}
