import { describe, expect, test } from "vitest";
import {
  AltText,
  Author,
  AvatarRequest,
  AvatarResponse,
  BIO_MAX_LENGTH,
  Bio,
  CountsRequest,
  CreatePostRequest,
  DisplayName,
  EngagementResponse,
  HandleChangeRequest,
  HandleParam,
  PostBody,
  PostCounts,
  PostId,
  PostView,
  ProfileEditRequest,
  ProfileListItem,
  ProfileView,
  SharePreviewsResponse,
  SocialErrorCode,
  ThreadResponse,
  TimelineItem,
  TimelinePage,
  ViewerPostState,
  normalizePostBody,
  postLength,
  visibleLength,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// 2d Task 3: every author carries its avatar, null while it has none.
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false, avatar: null };
const counts = { likes: 0, reposts: 0, replies: 0, quotes: 0 };
const post = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  author,
  body: "hello",
  createdAt: "2026-09-17T10:00:00.000Z",
  state: "visible",
  replyTo: null,
  counts,
  media: [],
  quoteOf: null,
  imported: null,
  mentions: [],
  countsHidden: false,
  ...extra,
});

describe("post bodies", () => {
  test("normalization: NFC, CR LF to LF, at most two line breaks, trimmed", () => {
    expect(normalizePostBody("  e\u0301\r\nb\n\n\n\nc  ")).toBe("\u00e9\nb\n\nc");
    expect(PostBody.parse("\n a\r\n\r\nb \n")).toBe("a\n\nb");
  });
  test("tab and line feed are allowed, other control characters are not", () => {
    expect(PostBody.safeParse("a\tb\nc").success).toBe(true);
    expect(PostBody.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(PostBody.safeParse("a\u0085b").success).toBe(false);
  });
  test("length is counted in code points after normalization", () => {
    expect(postLength("\u{1F600}".repeat(3))).toBe(3);
    expect(PostBody.safeParse("\u{1F600}".repeat(1000)).success).toBe(true);
    expect(PostBody.safeParse("\u{1F600}".repeat(1001)).success).toBe(false);
    expect(PostBody.safeParse("   \n  ").success).toBe(false);
  });
  test("a post is a reply or a quote, never both", () => {
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", quoteOfId: id(2) }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", replyToId: id(2), quoteOfId: id(3) }).success).toBe(false);
  });
});

describe("invisible characters", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);
  test("direction overrides and zero-width spaces are refused in bodies, alt text and display names", () => {
    expect(PostBody.safeParse(`a${rlo}b`).success).toBe(false);
    expect(PostBody.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(AltText.safeParse(`cat${rlo}`).success).toBe(false);
    expect(DisplayName.safeParse(`Ada${zwsp}`).success).toBe(false);
  });
  test("joiners inside emoji stay allowed but do not count as text on their own", () => {
    const family = `${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`;
    expect(PostBody.safeParse(family).success).toBe(true);
    expect(PostBody.safeParse(zwj).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: zwj, media: [] }).success).toBe(false);
    expect(visibleLength(`a${zwj}b`)).toBe(2);
  });
  test("post ids are lowercased", () => {
    expect(PostId.parse("3B241101-E2BB-4255-8CAF-4136C566A962")).toBe("3b241101-e2bb-4255-8caf-4136c566a962");
  });
  test("a reply may point at a parent whose author is hidden from the viewer", () => {
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2), authorHandle: null } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { replyTo: { id: id(2) } })).success).toBe(false);
  });
});

describe("handles", () => {
  test("handle params strip the @ and lowercase, and reject invalid handles", () => {
    expect(HandleParam.parse(" @Ada_Lovelace ")).toBe("ada_lovelace");
    expect(HandleParam.safeParse("ab").success).toBe(false);
    expect(HandleParam.safeParse("has space").success).toBe(false);
  });
});

describe("post views", () => {
  test("a quote embeds one level and is otherwise a tombstone", () => {
    expect(PostView.safeParse(post(1, { quoteOf: post(2) })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), deleted: true } })).success).toBe(true);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2), unavailable: true } })).success).toBe(true);
    // The embedded post may not carry its own expanded quote, and a tombstone needs a reason.
    expect(PostView.safeParse(post(1, { quoteOf: post(2, { quoteOf: post(3) }) })).success).toBe(false);
    expect(PostView.safeParse(post(1, { quoteOf: { id: id(2) } })).success).toBe(false);
  });
  test("deleted is not a post state; deleted posts are tombstones", () => {
    expect(PostView.safeParse(post(1, { state: "deleted_by_author" })).success).toBe(false);
    expect(ThreadResponse.safeParse({ ancestors: [{ id: id(9), deleted: true }, post(2)], post: post(1), replies: { items: [], nextCursor: null } }).success).toBe(true);
  });
  test("the author's Explore chip is set or absent, never false, and an embedded quote does not carry it", () => {
    expect(PostView.parse(post(1, { inExplore: true })).inExplore).toBe(true);
    expect(PostView.parse(post(1))).not.toHaveProperty("inExplore");
    expect(PostView.safeParse(post(1, { inExplore: false })).success).toBe(false);
    expect(PostView.safeParse(post(1, { inExplore: "yes" })).success).toBe(false);
    // The chip is on the post card, not in the viewer's like, repost and bookmark state that an engagement answer replaces.
    expect(Object.keys(ViewerPostState.shape).sort()).toEqual(["bookmarked", "liked", "reposted"]);
    // An embed is not a card of its own: its fields are the quoted post's, without the chip.
    expect(PostView.parse(post(1, { quoteOf: post(2, { inExplore: true }) })).quoteOf).not.toHaveProperty("inExplore");
    expect(TimelineItem.parse({ kind: "post", post: post(1, { inExplore: true }) }).post.inExplore).toBe(true);
  });
  test("3b: an imported post carries its label last, the archive's day and never its second; a native post and a quoted one carry null or the label", () => {
    const label = { source: "x", at: "2019-03-03", shortened: false };
    // 2d (9.3) moved the pin: the label is followed by the mentions and the hidden-counts switch.
    expect(Object.keys(PostView.shape).slice(-3)).toEqual(["imported", "mentions", "countsHidden"]);
    expect(PostView.parse(post(1, { imported: label })).imported).toEqual(label);
    expect(PostView.parse(post(1)).imported).toBeNull();
    // Required: a view without the member is not a view of this contract.
    const { imported: _imported, ...without } = post(1);
    expect(PostView.safeParse(without).success).toBe(false);
    // The day only: a time of day, another source or a missing mark is refused.
    expect(PostView.safeParse(post(1, { imported: { ...label, at: "2019-03-03T12:00:00Z" } })).success).toBe(false);
    expect(PostView.safeParse(post(1, { imported: { ...label, source: "threads" } })).success).toBe(false);
    expect(PostView.safeParse(post(1, { imported: { source: "mastodon", at: "2019-03-03" } })).success).toBe(false);
    // A quoted post carries its label too (QuoteEmbed's short line), and is refused without the member.
    expect(PostView.parse(post(1, { quoteOf: post(2, { imported: { ...label, shortened: true } }) })).quoteOf).toMatchObject({ imported: { source: "x", shortened: true } });
    expect(PostView.safeParse(post(1, { quoteOf: without })).success).toBe(false);
  });
  test("2d (9.3): likes and reposts may be null, which is how a hidden count reads to anyone but the author, in a view, a quoted embed and an engagement answer; replies and quotes never are", () => {
    const hidden = { likes: null, reposts: null, replies: 2, quotes: 1 };
    expect(PostCounts.parse(hidden)).toEqual(hidden);
    expect(PostCounts.safeParse({ ...hidden, replies: null }).success).toBe(false);
    expect(PostCounts.safeParse({ ...hidden, quotes: null }).success).toBe(false);
    expect(PostCounts.safeParse({ ...hidden, likes: -1 }).success).toBe(false);
    expect(PostCounts.safeParse({ ...hidden, likes: undefined }).success).toBe(false);
    expect(PostView.parse(post(1, { counts: hidden, countsHidden: true })).counts).toEqual(hidden);
    expect(PostView.parse(post(1, { quoteOf: post(2, { counts: hidden }) })).quoteOf).toMatchObject({ counts: hidden });
    expect(EngagementResponse.parse({ counts: hidden, viewer: { liked: true, reposted: false, bookmarked: false } }).counts.likes).toBeNull();
  });
  test("2d (4.3, 9.3): a view carries the mentions that link for its reader and whether its counts are hidden, both required; a quoted embed carries neither", () => {
    expect(PostView.parse(post(1, { mentions: ["ada", "grace"] })).mentions).toEqual(["ada", "grace"]);
    expect(PostView.safeParse(post(1, { mentions: undefined })).success).toBe(false);
    expect(PostView.safeParse(post(1, { countsHidden: undefined })).success).toBe(false);
    expect(PostView.safeParse(post(1, { countsHidden: "yes" })).success).toBe(false);
    const embed = PostView.parse(post(1, { quoteOf: post(2, { mentions: ["ada"], countsHidden: true }) })).quoteOf;
    expect(embed).not.toHaveProperty("mentions");
    expect(embed).not.toHaveProperty("countsHidden");
  });
  test("2d (decision 26, 9.2): the composer's hideCounts is off unless sent, the counts switch takes a boolean, and the preview switch answers its state", () => {
    expect(CreatePostRequest.parse({ body: "x" }).hideCounts).toBe(false);
    expect(CreatePostRequest.parse({ body: "x", hideCounts: true }).hideCounts).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", hideCounts: "yes" }).success).toBe(false);
    expect(CountsRequest.parse({ hidden: true })).toEqual({ hidden: true });
    expect(CountsRequest.safeParse({}).success).toBe(false);
    expect(SharePreviewsResponse.parse({ sharePreviews: false })).toEqual({ sharePreviews: false });
  });
  test("timeline items are posts or reposts with the reposter", () => {
    expect(TimelineItem.safeParse({ kind: "post", post: post(1) }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1), repostedBy: author, repostedAt: "2026-09-17T11:00:00.000Z" }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1) }).success).toBe(false);
    expect(TimelinePage.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});

describe("profiles", () => {
  test("profile views carry counts and an optional viewer relation", () => {
    const base = { id: id(1), handle: "ada", displayName: "Ada", bio: "", verified: true, createdAt: "2026-09-17T10:00:00.000Z", counts: { posts: 1, followers: 2, following: 3 }, hasImported: false, avatar: null };
    expect(ProfileView.safeParse(base).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, viewer: { following: true, followedBy: false, blocked: false, muted: false } }).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, counts: { posts: -1, followers: 0, following: 0 } }).success).toBe(false);
    // 3b: whether the profile shows its Imported tab, for every reader alike; always present.
    expect(ProfileView.parse({ ...base, hasImported: true }).hasImported).toBe(true);
    const { hasImported: _hasImported, ...withoutTab } = base;
    expect(ProfileView.safeParse(withoutTab).success).toBe(false);
    expect(ProfileListItem.safeParse({ ...author, bio: "hi", viewerFollows: true }).success).toBe(true);
    // The author's Explore switch is theirs (2c design, section 6): the public profile never carries it.
    expect(Object.keys(ProfileView.shape)).not.toContain("showInExplore");
    expect(ProfileView.parse({ ...base, showInExplore: false })).not.toHaveProperty("showInExplore");
  });
  test("2d Task 3 (7.5, 9.3): an author, a profile list's item and a profile view each carry the avatar, its two paths or null, always present", () => {
    const avatar = { small: `/api/media/${id(9)}/small.webp`, large: `/api/media/${id(9)}/large.webp` };
    expect(Author.parse({ ...author, avatar })).toEqual({ ...author, avatar });
    expect(Author.parse(author).avatar).toBeNull();
    const { avatar: _none, ...without } = author;
    expect(Author.safeParse(without).success).toBe(false);
    expect(Author.safeParse({ ...author, avatar: { small: avatar.small } }).success).toBe(false);
    expect(ProfileListItem.parse({ ...author, avatar, bio: "hi" }).avatar).toEqual(avatar);
    expect(ProfileListItem.safeParse({ ...without, bio: "hi" }).success).toBe(false);
    const view = { id: id(1), handle: "ada", displayName: "Ada", bio: "", verified: false, createdAt: "2026-09-17T10:00:00.000Z", counts: { posts: 0, followers: 0, following: 0 }, hasImported: false };
    expect(ProfileView.parse({ ...view, avatar }).avatar).toEqual(avatar);
    expect(ProfileView.parse({ ...view, avatar: null }).avatar).toBeNull();
    expect(ProfileView.safeParse(view).success).toBe(false);
    // A post's author and a quoted post's author carry it too.
    expect(PostView.parse(post(2, { author: { ...author, avatar } })).author.avatar).toEqual(avatar);
  });

  test("2d Task 3 (7.3, 9.2): PUT /api/me/avatar takes an upload's id, canonical; both avatar routes answer the account's avatar or null", () => {
    expect(AvatarRequest.parse({ mediaId: id(9).toUpperCase() })).toEqual({ mediaId: id(9) });
    for (const bad of [{}, { mediaId: "x" }, { mediaId: null }]) expect(AvatarRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const avatar = { small: `/api/media/${id(9)}/small.webp`, large: `/api/media/${id(9)}/large.webp` };
    expect(AvatarResponse.parse({ avatar })).toEqual({ avatar });
    expect(AvatarResponse.parse({ avatar: null })).toEqual({ avatar: null });
    expect(AvatarResponse.safeParse({}).success).toBe(false);
  });

  test("the error codes are exactly the seven social ones, 3e's account_suspended last", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed", "account_suspended"]);
  });
});

describe("profile editing", () => {
  const rlo = String.fromCharCode(0x202e);
  const zwsp = String.fromCharCode(0x200b);
  const zwj = String.fromCharCode(0x200d);

  test("a bio is trimmed, may be empty, and has at most 160 code points", () => {
    expect(BIO_MAX_LENGTH).toBe(160);
    expect(Bio.parse("  Unpopular opinions, daily.  ")).toBe("Unpopular opinions, daily.");
    expect(Bio.parse("")).toBe("");
    expect(Bio.parse("   ")).toBe("");
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse("a".repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
    const astral = String.fromCodePoint(0x1f600);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH)).success).toBe(true);
    expect(Bio.safeParse(astral.repeat(BIO_MAX_LENGTH + 1)).success).toBe(false);
  });

  test("a bio is one line of plain text: no control, direction or zero-width characters; emoji joiners stay", () => {
    expect(Bio.safeParse(`a${String.fromCharCode(7)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(10)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(9)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x85)}b`).success).toBe(false);
    // The Unicode line and paragraph separators are line breaks too, though not control characters.
    expect(Bio.safeParse(`a${String.fromCharCode(0x2028)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${String.fromCharCode(0x2029)}b`).success).toBe(false);
    expect(Bio.safeParse(`a${rlo}b`).success).toBe(false);
    expect(Bio.safeParse(`a${zwsp}b`).success).toBe(false);
    expect(Bio.safeParse(`${String.fromCodePoint(0x1f468)}${zwj}${String.fromCodePoint(0x1f469)}`).success).toBe(true);
  });

  test("a profile edit changes the display name, the bio or both, never nothing", () => {
    expect(ProfileEditRequest.parse({ displayName: " Ada " })).toEqual({ displayName: "Ada" });
    expect(ProfileEditRequest.parse({ bio: "" })).toEqual({ bio: "" });
    expect(ProfileEditRequest.parse({ displayName: "Ada", bio: " hi " })).toEqual({ displayName: "Ada", bio: "hi" });
    expect(ProfileEditRequest.safeParse({}).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "" }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ displayName: "x".repeat(51) }).success).toBe(false);
    expect(ProfileEditRequest.safeParse({ bio: `a${rlo}b` }).success).toBe(false);
  });

  test("a handle change carries the handle as typed, lowercased; the flow decides whether it is valid", () => {
    expect(HandleChangeRequest.parse({ handle: " Ada_Lovelace " })).toEqual({ handle: "ada_lovelace" });
    expect(HandleChangeRequest.safeParse({}).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "" }).success).toBe(false);
    expect(HandleChangeRequest.safeParse({ handle: "x".repeat(65) }).success).toBe(false);
  });
});

describe("posts with images", () => {
  const img = (n: number, alt = "an image") => ({ id: id(n), alt });

  test("a post needs text or an image; the body defaults to empty and media to none", () => {
    // 2d (decision 26): and hideCounts to off.
    expect(CreatePostRequest.parse({ body: "hello" })).toEqual({ body: "hello", media: [], hideCounts: false });
    expect(CreatePostRequest.parse({ media: [img(1)] })).toEqual({ body: "", media: [img(1)], hideCounts: false });
    expect(CreatePostRequest.parse({ body: "  ", media: [img(1)] }).body).toBe("");
    expect(CreatePostRequest.safeParse({}).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "   ", media: [] }).success).toBe(false);
  });

  test("at most four images, each only once, each with a description", () => {
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(2), img(3), img(4), img(5)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1), img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [img(1, "  ")] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "x", media: [{ id: id(1) }] }).success).toBe(false);
    expect(CreatePostRequest.parse({ body: "x", media: [img(1, "  a   cat ")] }).media[0]!.alt).toBe("a cat");
  });

  test("the text rules still hold for a post with images, and replies and quotes may carry images", () => {
    expect(CreatePostRequest.safeParse({ body: "a".repeat(1001), media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ body: "a\u0000b", media: [img(1)] }).success).toBe(false);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ quoteOfId: id(7), media: [img(1)] }).success).toBe(true);
    expect(CreatePostRequest.safeParse({ replyToId: id(7), quoteOfId: id(8), media: [img(1)] }).success).toBe(false);
  });
});

