import { z } from "zod";
import { DisplayName, HandleInput } from "./auth";
import { ImportSource } from "./imports";
import { AvatarView, HiddenMedia, MEDIA_MAX_PER_POST, MediaAttachment, MediaId, MediaView } from "./media";
import { RULE_IDS } from "./moderation";
import { FORBIDDEN_CONTROL, FORBIDDEN_FORMAT, normalizePostBody, postLength, visibleLength } from "./text";

/**
 * Every code the social endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited).
 * explore_refreshed (409) refuses a page of an Explore ranking that is no longer kept. account_suspended (403, 3e design,
 * section 10.5) refuses a write of an account while a suspension or termination of it runs; the media, auth and
 * moderation modules answer it too, as a code they share with this one.
 */
export const SocialErrorCode = z.enum(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed", "account_suspended"]);
export type SocialErrorCode = z.infer<typeof SocialErrorCode>;

/** Postgres returns lowercase ids; the canonical form, so a lookup by any spelling finds the row. */
export const PostId = z.uuid().transform((id) => id.toLowerCase());

/** A handle from a URL or a lookup box: an optional leading @, then the 3 to 20 characters handles may contain. */
export const HandleParam = z
  .string()
  .trim()
  .regex(/^@?[A-Za-z0-9_]{3,20}$/)
  .transform((value) => value.replace(/^@/, "").toLowerCase());

export const POST_MAX_LENGTH = 1000;

// 3b Task 1: postLength, normalizePostBody and FORBIDDEN_CONTROL live in ./text, so that imports.ts can read the body rules
// without loading this module, which reads moderation.ts at load.

/** A post body as stored: normalized, 1 to 1000 code points, some of them visible, no control or disguising characters. */
export const PostBody = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => visibleLength(body) >= 1, { message: "a post needs some text" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => !FORBIDDEN_FORMAT.test(body), { message: "invisible direction and spacing characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
    /** 2d (decision 26, 10.6): the composer's "Hide like and repost counts", off unless sent. */
    hideCounts: z.boolean().default(false),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => visibleLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

// ---------------------------------------------------------------- posts

/** 2d Task 3 (7.5, 9.3): `avatar`, the author's picture as every reader of a view gets it, or null for the monogram. */
export const Author = z.object({ id: z.uuid(), handle: z.string(), displayName: z.string(), verified: z.boolean(), avatar: AvatarView.nullable() });
export type Author = z.infer<typeof Author>;

/** Stands in for a post where its absence would break structure: an ancestor in a thread or a quoted embed. */
export const Tombstone = z
  .strictObject({ id: z.uuid(), deleted: z.literal(true).optional(), unavailable: z.literal(true).optional() })
  .refine((t) => t.deleted === true || t.unavailable === true, { message: "a tombstone is deleted or unavailable" });
export type Tombstone = z.infer<typeof Tombstone>;

/** Never deleted_by_author: deleted posts only ever appear as tombstones. */
export const PostState = z.enum(["visible", "withheld", "removed"]);
export type PostState = z.infer<typeof PostState>;

/**
 * A post's counts. 2d (decision 26, 9.3): `likes` and `reposts` are null exactly when the post's author hid its counts and
 * the reader is not its author, in every answer that carries counts (a view, a quoted embed, and the answer to the
 * reader's own like, unlike, repost or unrepost), so no reader learns a hidden count by liking. Replies and quotes are
 * always numbers.
 */
export const PostCounts = z.object({
  likes: z.number().int().min(0).nullable(),
  reposts: z.number().int().min(0).nullable(),
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
  /** The handle is null when the viewer could not open the parent: its author is blocked either way, or it is hidden or deleted. */
  replyTo: z.object({ id: z.uuid(), authorHandle: z.string().nullable() }).nullable(),
  counts: PostCounts,
  /** The post's images in order, each as the image or, where the reader is not shown it, as a hidden image in its place. Always present, often empty. */
  media: z.array(z.union([MediaView, HiddenMedia])),
  /** Present only for a signed-in viewer. */
  viewer: ViewerPostState.optional(),
};

/**
 * 3b (design, sections 8.4, 9.3 and 10.6): the provenance label of an imported post, made from the post's own columns and
 * nothing else: its source, the archive's day (YYYY-MM-DD in UTC, never its second, which with the text would fingerprint
 * the original) and whether it was cut to 1,000 characters on import. Null on every native post.
 */
export const ImportedLabel = z.object({ source: ImportSource, at: z.iso.date(), shortened: z.boolean() });
export type ImportedLabel = z.infer<typeof ImportedLabel>;

/**
 * A quoted post as embedded: one level deep, so its own quote is not expanded. 3b (the orchestrator's ruling for Task 6):
 * it carries the label as PostView does, last, for QuoteEmbed's short line (10.6).
 */
export const QuotedPost = z.object({ ...postFields, quoteOf: z.null(), imported: ImportedLabel.nullable() });
export type QuotedPost = z.infer<typeof QuotedPost>;

/**
 * The decision behind the state of the viewer's own withheld or removed post (3c design, sections 5 and 7.6): the decision
 * of the strongest post measure in force, by its id, the rule it cites (null for a decision on the law), whether it rests
 * on the law, and whether korbat is still deciding. The app shows it as the chip that links to the statement. `strikeUntil`
 * (3e design, section 10.2) is the end of counting of the strike the post's decision gave, while that strike stands and
 * still counts; null otherwise.
 */
// 3f: `order` is true when the chip's decision gives effect to an authority's order (a DSA Article 9 order that does not
// withhold, the only order that leaves a post its author sees), so the chip reads [chip.order]; absent otherwise.
export const PostModeration = z.object({ decisionId: z.uuid(), ruleId: z.enum(RULE_IDS).nullable(), legal: z.boolean(), interim: z.boolean(), strikeUntil: z.iso.datetime().nullable(), order: z.boolean().optional() });
export type PostModeration = z.infer<typeof PostModeration>;

export const PostView = z.object({
  ...postFields,
  /**
   * The author's "In Explore" chip (2c design, section 8): present, and true, only on the viewer's own post while it is in
   * the current Explore ranking with their switch on. Nobody else's view carries it, nor does a quoted embed. It sits here
   * rather than in `viewer`, which the like, repost and bookmark answers replace.
   */
  inExplore: z.literal(true).optional(),
  /** Present only on the viewer's own post while moderation withholds or removed it; nobody else's view carries it, nor does a quoted embed. */
  moderation: PostModeration.optional(),
  quoteOf: z.union([QuotedPost, Tombstone]).nullable(),
  /** 3b (9.3): the provenance label of an imported post, last; null on a native post. */
  imported: ImportedLabel.nullable(),
  /**
   * 2d (4.3): the handles of the post's stored mentions that link for this reader, lowercased, in text order: each one's
   * account is live, still holds the handle as written, and (for a signed-in reader) has no block either way with the
   * reader. Always empty for an imported post. After the label; a quoted embed carries none (QuotedPost), since it draws
   * its text plain.
   */
  mentions: z.array(z.string()),
  /** 2d (decision 26): the author hid the like and repost counts; last. Anyone else then reads them as null (PostCounts). */
  countsHidden: z.boolean(),
});
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

/** 2d (9.2): PATCH /api/posts/:id/counts, the author's switch of decision 26; its answer is CountsResponse. */
export const CountsRequest = z.object({ hidden: z.boolean() });
export type CountsRequest = z.infer<typeof CountsRequest>;
export const CountsResponse = z.object({ countsHidden: z.boolean() });
export type CountsResponse = z.infer<typeof CountsResponse>;

/** 2d (9.2, decision 21): what POST and DELETE /api/me/share-previews answer, as /api/me/explore answers its switch. */
export const SharePreviewsResponse = z.object({ sharePreviews: z.boolean() });
export type SharePreviewsResponse = z.infer<typeof SharePreviewsResponse>;

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
  /**
   * 3b (9.3, 10.6): the account has a visible imported top-level post, so the profile shows its Imported tab, for every
   * reader alike.
   */
  hasImported: z.boolean(),
  /** 2d Task 3 (7.5, 9.3): the profile's picture, or null while it has none or none is shown. */
  avatar: AvatarView.nullable(),
  /** Present only for a signed-in viewer looking at someone else. */
  viewer: ViewerProfileState.optional(),
});
export type ProfileView = z.infer<typeof ProfileView>;

export const ProfileListItem = Author.extend({ bio: z.string(), viewerFollows: z.boolean().optional() });
export type ProfileListItem = z.infer<typeof ProfileListItem>;

export const ProfilePage = page(ProfileListItem);
export type ProfilePage = z.infer<typeof ProfilePage>;

// ---------------------------------------------------------------- profile editing

export const BIO_MAX_LENGTH = 160;

/** A bio as stored: trimmed, at most 160 code points, one line of plain text with no control or disguising characters. Empty clears it. */
export const Bio = z
  .string()
  .trim()
  // The line and paragraph separators (Zl, Zp) break a line as a newline does, without being control characters.
  .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, "control characters and line breaks are not allowed")
  .refine((bio) => !FORBIDDEN_FORMAT.test(bio), { message: "invisible direction and spacing characters are not allowed" })
  .refine((bio) => postLength(bio) <= BIO_MAX_LENGTH, { message: `bios have at most ${BIO_MAX_LENGTH} characters` });

/** What the profile screen saves: either field, or both. The handle has its own route and rules. */
export const ProfileEditRequest = z
  .object({ displayName: DisplayName.optional(), bio: Bio.optional() })
  .refine((edit) => edit.displayName !== undefined || edit.bio !== undefined, { message: "nothing to change" });
export type ProfileEditRequest = z.infer<typeof ProfileEditRequest>;

/**
 * 2d Task 3 (7.3, 9.2): PUT /api/me/avatar sets the account's picture to one of its own uploads of kind avatar that is
 * ready; DELETE /api/me/avatar takes no body. Both answer AvatarResponse: the picture now, or null after a removal.
 */
export const AvatarRequest = z.object({ mediaId: MediaId });
export type AvatarRequest = z.infer<typeof AvatarRequest>;
export const AvatarResponse = z.object({ avatar: AvatarView.nullable() });
export type AvatarResponse = z.infer<typeof AvatarResponse>;

/** The handle rules and the 30-day cooldown are enforced by the flow, which answers with a specific error code. */
export const HandleChangeRequest = z.object({ handle: HandleInput });
export type HandleChangeRequest = z.infer<typeof HandleChangeRequest>;
