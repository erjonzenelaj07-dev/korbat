import {
  BlockResponse,
  EngagementResponse,
  ExplorePage,
  ExploreSettingResponse,
  ExploreStatus,
  FollowResponse,
  MediaStatusResponse,
  MuteResponse,
  PostId,
  PostPage,
  PostView,
  type ProfileEditRequest,
  ProfilePage,
  ProfileView,
  ThreadResponse,
  TimelinePage,
  UploadResponse,
} from "@korbat/contracts";
import { z } from "zod";
import { api, apiResponse } from "./api";

export type EngagementKind = "like" | "repost" | "bookmark";
export type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * A page of Explore as it arrived: with the answer's Date header, the server's clock when it answered (null when the
 * answer has none), and the device's clock on arrival. The list ages the ranking by the first and counts the time on
 * screen from the second, so the device's clock is never compared with the server's.
 */
export type ExploreAnswer = ExplorePage & { date: string | null; receivedAt: number };

const query = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
/** Ids come from route params; only a UUID may become part of a path. */
const postPath = (id: string) => `/api/posts/${encodeURIComponent(PostId.parse(id))}`;
const handlePath = (handle: string) => `/api/profiles/${encodeURIComponent(handle.replace(/^@/, "").toLowerCase())}`;

/** The signed-in account's own profile as the editing routes answer it: the public view, since /api/me carries no bio. */
const OwnProfileResponse = z.object({ profile: ProfileView });

/** Every social endpoint, typed by the shared contracts. Cookies and CSRF are handled by `api`. */
export const social = {
  createPost: (input: { body: string; replyToId?: string; quoteOfId?: string; media?: { id: string; alt: string }[] }) => api("/api/posts", { json: input, schema: PostView }),
  getPost: (id: string) => api(postPath(id), { schema: PostView }),
  deletePost: (id: string) => api(postPath(id), { method: "DELETE" }),
  thread: (id: string, cursor?: string) => api(`${postPath(id)}/thread${query(cursor)}`, { schema: ThreadResponse }),
  engage: (id: string, kind: EngagementKind, on: boolean) => api(`${postPath(id)}/${kind}`, { method: on ? "POST" : "DELETE", schema: EngagementResponse }),
  /** Why the author's own post is in Explore or not, with no count (2c design, section 8); anyone else gets not_found. */
  exploreStatus: (id: string) => api(`${postPath(id)}/explore`, { schema: ExploreStatus }),

  /** Sends one image file as the request body. The answer is an id to ask about, not a finished image. */
  uploadMedia: (file: Blob) => api("/api/media", { raw: { type: file.type, body: file }, schema: UploadResponse }),
  mediaStatus: (id: string) => api(`/api/media/${id}`, { schema: MediaStatusResponse }),
  removeMedia: (id: string) => api(`/api/media/${id}`, { method: "DELETE" }),

  following: (cursor?: string) => api(`/api/timeline/following${query(cursor)}`, { schema: TimelinePage }),
  latest: (cursor?: string) => api(`/api/timeline/latest${query(cursor)}`, { schema: TimelinePage }),
  /**
   * A page of Explore (2c design, section 8). Its cursor names the ranking it came from, which a refresh can prune
   * (explore_refreshed); signed out, the first page is all there is, and signInForMore says whether more exist. The web
   * app is served from the API's origin, so the answer's Date header can be read, and it is kept with the page; an API on
   * another origin would hide it from the browser, and the list then ages the ranking by the device's clock.
   */
  explore: async (cursor?: string): Promise<ExploreAnswer> => {
    const res = await apiResponse(`/api/timeline/explore${query(cursor)}`);
    const page = ExplorePage.parse(await res.json());
    return { ...page, date: res.headers.get("date"), receivedAt: Date.now() };
  },
  /** The first three posts of Explore, for the context column's Popular now. */
  popular: () => api("/api/timeline/explore?limit=3", { schema: ExplorePage }),

  profile: (handle: string) => api(handlePath(handle), { schema: ProfileView }),
  profilePosts: (handle: string, cursor?: string) => api(`${handlePath(handle)}/posts${query(cursor)}`, { schema: TimelinePage }),
  profileReplies: (handle: string, cursor?: string) => api(`${handlePath(handle)}/replies${query(cursor)}`, { schema: PostPage }),
  followers: (handle: string, cursor?: string) => api(`${handlePath(handle)}/followers${query(cursor)}`, { schema: ProfilePage }),
  followingOf: (handle: string, cursor?: string) => api(`${handlePath(handle)}/following${query(cursor)}`, { schema: ProfilePage }),
  setFollow: (handle: string, on: boolean) => api(`${handlePath(handle)}/follow`, { method: on ? "POST" : "DELETE", schema: FollowResponse }),
  setBlock: (handle: string, on: boolean) => api(`${handlePath(handle)}/block`, { method: on ? "POST" : "DELETE", schema: BlockResponse }),
  setMute: (handle: string, on: boolean) => api(`${handlePath(handle)}/mute`, { method: on ? "POST" : "DELETE", schema: MuteResponse }),

  myLikes: (cursor?: string) => api(`/api/me/likes${query(cursor)}`, { schema: PostPage }),
  myBookmarks: (cursor?: string) => api(`/api/me/bookmarks${query(cursor)}`, { schema: PostPage }),
  myBlocks: (cursor?: string) => api(`/api/me/blocks${query(cursor)}`, { schema: ProfilePage }),
  myMutes: (cursor?: string) => api(`/api/me/mutes${query(cursor)}`, { schema: ProfilePage }),

  /** Either field or both; the caller refreshes the session afterwards, so the shell's Profile link follows a new name. */
  editProfile: (edit: ProfileEditRequest) => api("/api/me/profile", { method: "PATCH", json: edit, schema: OwnProfileResponse }),
  /** Needs fresh authentication: the caller runs it through useReauth. */
  changeHandle: (handle: string) => api("/api/me/handle", { json: { handle }, schema: OwnProfileResponse }),
  /** "Show my posts in Explore", on or off, with no body as the other switches; the caller refreshes the session, whose /api/me carries it. */
  setShowInExplore: (on: boolean) => api("/api/me/explore", { method: on ? "POST" : "DELETE", schema: ExploreSettingResponse }),
};

/** timeAgo lives in lib/time.ts with korbat's other times (UI design, section 8.1); its callers keep importing it from here. */
export { timeAgo } from "./time";
