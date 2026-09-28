import { describe, expect, test } from "vitest";
import {
  AltText,
  BIO_MAX_LENGTH,
  Bio,
  CreatePostRequest,
  DisplayName,
  HandleChangeRequest,
  HandleParam,
  PostBody,
  PostId,
  PostView,
  ProfileEditRequest,
  ProfileListItem,
  ProfileView,
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
const author = { id: id(1), handle: "ada", displayName: "Ada", verified: false };
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
  test("timeline items are posts or reposts with the reposter", () => {
    expect(TimelineItem.safeParse({ kind: "post", post: post(1) }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1), repostedBy: author, repostedAt: "2026-09-17T11:00:00.000Z" }).success).toBe(true);
    expect(TimelineItem.safeParse({ kind: "repost", post: post(1) }).success).toBe(false);
    expect(TimelinePage.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });
});

describe("profiles", () => {
  test("profile views carry counts and an optional viewer relation", () => {
    const base = { id: id(1), handle: "ada", displayName: "Ada", bio: "", verified: true, createdAt: "2026-09-17T10:00:00.000Z", counts: { posts: 1, followers: 2, following: 3 } };
    expect(ProfileView.safeParse(base).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, viewer: { following: true, followedBy: false, blocked: false, muted: false } }).success).toBe(true);
    expect(ProfileView.safeParse({ ...base, counts: { posts: -1, followers: 0, following: 0 } }).success).toBe(false);
    expect(ProfileListItem.safeParse({ ...author, bio: "hi", viewerFollows: true }).success).toBe(true);
    // The author's Explore switch is theirs (2c design, section 6): the public profile never carries it.
    expect(Object.keys(ProfileView.shape)).not.toContain("showInExplore");
    expect(ProfileView.parse({ ...base, showInExplore: false })).not.toHaveProperty("showInExplore");
  });
  test("the error codes are exactly the six social ones", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new", "explore_refreshed"]);
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
    expect(CreatePostRequest.parse({ body: "hello" })).toEqual({ body: "hello", media: [] });
    expect(CreatePostRequest.parse({ media: [img(1)] })).toEqual({ body: "", media: [img(1)] });
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

