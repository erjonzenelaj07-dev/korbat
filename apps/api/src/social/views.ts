import type { Author, AvatarView, HiddenMedia, MediaView, PostCounts, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { PostImage } from "../media";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, their images through the media module, and the chip's facts through the moderation module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media" | "moderation">;

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

/** 2d Task 3 (7.5): with the profile's avatar as avatarsOf answered it for the page, null for the monogram. */
export function authorOf(profile: ProfileRow, avatar: AvatarView | null): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified, avatar };
}

/**
 * One image of a post as this viewer gets it (3c design, section 7.10). A visible image is the image. A withheld or
 * removed one stays with its author, who gets it with that state; anyone else gets a placeholder in its place, the same
 * for both states, with nothing of the image in it. A sealed image is that placeholder for every viewer, its author
 * included, who alone is told that it is sealed.
 */
export function mediaFor(viewer: ViewerId, authorId: string, image: PostImage): MediaView | HiddenMedia {
  const own = viewer !== null && viewer === authorId;
  if (image.state === "sealed") return own ? { id: image.id, hidden: true, sealed: true } : { id: image.id, hidden: true };
  const { state, ...view } = image;
  if (state === "visible") return view;
  return own ? { ...view, moderation: state } : { id: image.id, hidden: true };
}

/**
 * 2d (decision 26, 9.3): a post's counts as this reader gets them, the one rule for every answer that carries counts (a
 * view, a quoted embed, and the engagement answer of flows/engagement.ts): likes and reposts are null exactly when the
 * author hid them and the reader is not the author; replies and quotes are always numbers. So nobody but the author
 * learns a hidden count, by reading it or by liking and unliking.
 */
export function countsFor(viewer: ViewerId, row: PostRow): PostCounts {
  const hidden = row.hideCounts && viewer !== row.authorId;
  return { likes: hidden ? null : row.likeCount, reposts: hidden ? null : row.repostCount, replies: row.replyCount, quotes: row.quoteCount };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state, and every post's images, each as this viewer gets it
 * (mediaFor). Ids that resolve to nothing become tombstones, and tombstones carry no images. The
 * viewer's own visible posts that the current Explore ranking holds, while their switch is on, carry
 * the author's chip (2c design, section 8):
 * asked in one query, and only when the viewer wrote some of the posts; a quoted embed never carries it.
 * The viewer's own withheld and removed posts carry the decision behind their state (3c design, section 7.6), which the
 * moderation module names: asked the same way, once for the page and only when the viewer wrote such a post.
 * 2d (4.3): each post it shows carries the mentions that link for this viewer, read for the page's shown posts in one
 * statement (mentionsFor); a quoted embed carries none. Counts go through countsFor. 2d Task 3 (7.5): every author's
 * avatar, the quoted posts' authors' too, from one avatarsOf of the media module for the whole page.
 */
export async function loadPostViews({ repo, media, moderation }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].flatMap((row) => (row.replyToAuthorId ? [row.authorId, row.replyToAuthorId] : [row.authorId])))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);
  const avatars = await media.avatarsOf([...new Set([...all.values()].map((row) => row.authorId))], viewer);
  // A withheld or removed post is never in Explore for anyone, its author included, so only visible ones are asked about.
  // Whether the author is suspended when this reads is listedInExplore's to judge (3e), so the chip goes with the page.
  const own = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && row.state === "visible").map((row) => row.id) : [];
  const inExplore = viewer && own.length > 0 ? await repo.listedInExplore(viewer, own) : new Set<string>();
  // The chip of a withheld or removed post is its author's alone, so only the viewer's own such posts are asked about.
  const restricted = viewer ? [...primary.values()].filter((row) => row.authorId === viewer && (row.state === "withheld" || row.state === "removed")).map((row) => row.id) : [];
  const decisions = viewer && moderation && restricted.length > 0 ? await moderation.authorFacts(viewer, restricted) : null;

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  // Only the posts this viewer is shown: a hidden or deleted post's mentions are never read.
  const mentioned = await repo.mentionsFor(viewer, [...primary.values()].filter((row) => access(row) === "shown").map((row) => row.id));
  /** The parent's handle only when the viewer could open the parent; a block either way, or a hidden or deleted parent, gives null. */
  const parentHandle = (row: PostRow): string | null =>
    row.replyToAuthorId && row.replyToState && postAccess(viewer, { authorId: row.replyToAuthorId, state: row.replyToState }, blocked.has(row.replyToAuthorId)) === "shown"
      ? row.replyToHandle
      : null;
  const base = (row: PostRow) => ({
    id: row.id,
    author: { ...row.author, avatar: avatars.get(row.authorId) ?? null },
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: parentHandle(row) } : null,
    counts: countsFor(viewer, row),
    media: (images.get(row.id) ?? []).map((image) => mediaFor(viewer, row.authorId, image)),
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    // 3b: a quoted post carries its provenance label too, last, for the embed's short line (10.6).
    return a === "shown" ? { ...base(row), quoteOf: null, imported: row.imported } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    const decision = decisions?.get(id);
    // 3b (9.3): the provenance label, from the post's own columns: the archive's day, never its second. 2d (9.3): then the
    // mentions that link for this viewer and the author's hidden-counts switch, last.
    out.set(
      id,
      a === "shown"
        ? {
            ...base(row),
            ...(inExplore.has(id) ? { inExplore: true as const } : {}),
            ...(decision ? { moderation: decision } : {}),
            quoteOf: quoteOf(row.quoteOfId),
            imported: row.imported,
            mentions: mentioned.get(id) ?? [],
            countsHidden: row.hideCounts,
          }
        : tombstone(id, a),
    );
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(source: ViewSource, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(source, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(source: ViewSource, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(source, viewer, rows.map((row) => row.postId));
  const reposterIds = [...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))];
  const reposters = await source.repo.findProfiles(reposterIds);
  // 2d Task 3: the reposters' avatars, one more statement only for a page that holds a repost.
  const avatars = reposterIds.length > 0 ? await source.media.avatarsOf(reposterIds, viewer) : new Map<string, AvatarView>();
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter, avatars.get(reposter.id) ?? null), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
