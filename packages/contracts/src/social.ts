import { z } from "zod";

/** Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

export const PostId = z.uuid();

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

/** Length in code points, which is what Postgres char_length counts. */
export function postLength(body: string): number {
  return Array.from(body).length;
}

/** Unicode NFC, CR LF to LF, at most two consecutive line breaks, trimmed. The server and the composer use the same rule. */
export function normalizePostBody(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Any control character other than tab and line feed. */
const FORBIDDEN_CONTROL = /[^\P{Cc}\t\n]/u;

/** A post body as stored: normalized, 1 to 1000 code points, no control characters other than tab and line feed. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => postLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

export const CreatePostRequest = z
  .object({ body: PostBody, replyToId: PostId.optional(), quoteOfId: PostId.optional() })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

export const PostCounts = z.object({
  likes: z.number().int().min(0),
  reposts: z.number().int().min(0),
  replies: z.number().int().min(0),
  quotes: z.number().int().min(0),
});
export type PostCounts = z.infer<typeof PostCounts>;

export const ViewerPostState = z.object({ liked: z.boolean(), reposted: z.boolean(), bookmarked: z.boolean() });
export type ViewerPostState = z.infer<typeof ViewerPostState>;

const postFields = {
  id: z.uuid(),
  author: Author,
  body: z.string(),
  createdAt: z.iso.datetime(),
  state: PostState,
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string() }).nullable(),
  counts: PostCounts,
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/** A quoted post as embedded: one level deep, so its own quote is not expanded. */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null() });
export type QuotedPost = z.infer<typeof QuotedPost>;

export const PostView = z.object({ ...postFields, quoteOf: z.union([QuotedPost, Tombstone]).nullable() });
export type PostView = z.infer<typeof PostView>;

/** An item of a timeline or a profile's Posts tab. */
export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("post"), post: PostView }),
  z.object({ kind: z.literal("repost"), post: PostView, repostedBy: Author, repostedAt: z.iso.datetime() }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const TimelinePage = page(TimelineItem);
export type TimelinePage = z.infer<typeof TimelinePage>;
export const PostPage = page(PostView);
export type PostPage = z.infer<typeof PostPage>;

export const ThreadResponse = z.object({
  ancestors: z.array(z.union([PostView, Tombstone])),
  post: PostView,
  replies: PostPage,
});
export type ThreadResponse = z.infer<typeof ThreadResponse>;

// ---------------------------------------------------------------- engagement and graph

export const EngagementResponse = z.object({ counts: PostCounts, viewer: ViewerPostState });
export type EngagementResponse = z.infer<typeof EngagementResponse>;

export const FollowResponse = z.object({ following: z.boolean(), followerCount: z.number().int().min(0) });
export type FollowResponse = z.infer<typeof FollowResponse>;

export const BlockResponse = z.object({ blocked: z.boolean() });
export type BlockResponse = z.infer<typeof BlockResponse>;

export const MuteResponse = z.object({ muted: z.boolean() });
export type MuteResponse = z.infer<typeof MuteResponse>;

// ---------------------------------------------------------------- profiles

export const ProfileCounts = z.object({
  posts: z.number().int().min(0),
  followers: z.number().int().min(0),
  following: z.number().int().min(0),
});

export const ViewerProfileState = z.object({ following: z.boolean(), followedBy: z.boolean(), blocked: z.boolean(), muted: z.boolean() });
export type ViewerProfileState = z.infer<typeof ViewerProfileState>;

export const ProfileView = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
  counts: ProfileCounts,
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;
