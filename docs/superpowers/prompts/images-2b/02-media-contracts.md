# korbat 2b — Task 2 of 17: Media contracts: limits, alt text, upload and status responses, media views, and a media list on every post view

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Every request and response is a Zod schema in `@korbat/contracts`, shared by the API, the worker and the app. This task adds the media schemas before any code uses them: the limits (20 MB, four images, the accepted types), the description rule and its normalization, the upload and status responses, and the media view a post carries. Media ids are UUIDs made canonical in lowercase, the only form the volume layout accepts. Every post view gains a media list, empty for now.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `test(api): integration tests run in korbat_test and Redis database 15, load their own environment and refuse any other target`.
3. The previous task's last API unit run ended with `Tests  114 passed | 96 skipped (210)`.

## Rules (read twice)

1. Never type a file's content. Every step that writes files starts with a `write_blocks.py` command that copies that step's blocks from this prompt file to disk byte for byte; run it exactly as given and check that it names every file of the step. The blocks are shown below it so you can read what was written. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/02-media-contracts.md 1
```

Expected: 2 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/test/media.test.ts`

```ts
import { describe, expect, test } from "vitest";
import {
  ALT_MAX_LENGTH,
  AltText,
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_POST,
  MediaAttachment,
  MediaErrorCode,
  MediaFailure,
  MediaStatusResponse,
  MediaView,
  PostView,
  UploadResponse,
  altLength,
  mediaPath,
  normalizeAltText,
} from "../src/index";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("limits and codes", () => {
  test("the numbers the API and the composer share", () => {
    expect(MEDIA_MAX_BYTES).toBe(20_971_520);
    expect(MEDIA_MAX_PER_POST).toBe(4);
    expect(ALT_MAX_LENGTH).toBe(1000);
    expect([...MEDIA_ACCEPTED_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
  });

  test("error codes and failure reasons", () => {
    expect(MediaErrorCode.options).toEqual(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
    expect(MediaFailure.options).toEqual(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
  });

  test("image paths end in .webp, which is what a CDN caches by default", () => {
    expect(mediaPath(id(7), "small")).toBe(`/api/media/${id(7)}/small.webp`);
    expect(mediaPath(id(7), "large")).toBe(`/api/media/${id(7)}/large.webp`);
  });
});

describe("alt text", () => {
  test("normalization: NFC, every run of whitespace to one space, trimmed", () => {
    expect(normalizeAltText("  a  red\tbarn\r\n\r\nat dusk ")).toBe("a red barn at dusk");
    expect(normalizeAltText("e\u0301")).toBe("\u00e9");
  });

  test("a description is required", () => {
    expect(AltText.safeParse("").success).toBe(false);
    expect(AltText.safeParse(" \n\t ").success).toBe(false);
    expect(AltText.parse(" a cat ")).toBe("a cat");
  });

  test("length is counted in code points after normalization", () => {
    const astral = "\u{1F600}";
    expect(altLength(astral.repeat(3))).toBe(3);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH)).success).toBe(true);
    expect(AltText.safeParse(astral.repeat(ALT_MAX_LENGTH + 1)).success).toBe(false);
    expect(AltText.safeParse(`${"a".repeat(ALT_MAX_LENGTH)}   `).success).toBe(true);
  });

  test("control characters are refused, including ones JavaScript does not count as whitespace", () => {
    expect(AltText.safeParse("a\u0000b").success).toBe(false);
    expect(AltText.safeParse("a\u0085b").success).toBe(false);
    expect(AltText.safeParse("a\u001bb").success).toBe(false);
  });

  test("an attachment is an upload id and a description", () => {
    expect(MediaAttachment.parse({ id: id(1), alt: "  a   cat " })).toEqual({ id: id(1), alt: "a cat" });
    expect(MediaAttachment.safeParse({ id: "nope", alt: "a cat" }).success).toBe(false);
    expect(MediaAttachment.safeParse({ id: id(1) }).success).toBe(false);
  });
});

describe("upload and status responses", () => {
  test("an upload starts as processing", () => {
    expect(UploadResponse.parse({ id: id(1), status: "processing" })).toEqual({ id: id(1), status: "processing" });
    expect(UploadResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
  });

  test("each status carries exactly what it needs", () => {
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "processing" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "ready", width: 0, height: 1536, blurhash: "L2Eo_P_3jb_3" }).success).toBe(false);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "animated_not_supported" }).success).toBe(true);
    expect(MediaStatusResponse.safeParse({ id: id(1), status: "failed", error: "because" }).success).toBe(false);
  });
});

describe("images on posts", () => {
  const image = { id: id(9), width: 2048, height: 1536, blurhash: "L2Eo_P_3jb_3", alt: "a cat", small: mediaPath(id(9), "small"), large: mediaPath(id(9), "large") };
  const post = {
    id: id(2),
    author: { id: id(1), handle: "ada", displayName: "Ada", verified: false },
    body: "",
    createdAt: "2026-09-18T10:00:00.000Z",
    state: "visible",
    replyTo: null,
    counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 },
    quoteOf: null,
  };

  test("a media view has dimensions, a placeholder, a description and both paths", () => {
    expect(MediaView.parse(image)).toEqual(image);
    expect(MediaView.safeParse({ ...image, blurhash: "" }).success).toBe(false);
    expect(MediaView.safeParse({ ...image, large: undefined }).success).toBe(false);
  });

  test("every post view has a media list, and a post may consist of images only", () => {
    expect(PostView.parse({ ...post, media: [image] }).media).toEqual([image]);
    expect(PostView.parse({ ...post, body: "text", media: [] }).media).toEqual([]);
    expect(PostView.safeParse(post).success).toBe(false);
  });

  test("a quoted post carries its images too", () => {
    const quoted = { ...post, id: id(3), media: [image] };
    const parsed = PostView.parse({ ...post, body: "look", media: [], quoteOf: quoted });
    expect(parsed.quoteOf).toMatchObject({ media: [image] });
  });
});
```

### Replace `packages/contracts/test/social.test.ts` (whole file)

```ts
import { describe, expect, test } from "vitest";
import {
  CreatePostRequest,
  HandleParam,
  PostBody,
  PostView,
  ProfileListItem,
  ProfileView,
  SocialErrorCode,
  ThreadResponse,
  TimelineItem,
  TimelinePage,
  normalizePostBody,
  postLength,
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
  });
  test("the error codes are exactly the five social ones", () => {
    expect(SocialErrorCode.options).toEqual(["post_unavailable", "not_author", "blocked", "self_target", "account_too_new"]);
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/contracts test
```

Expected: the command exits with an error, and the output contains:

- `mediaPath is not a function`

Observed on the dry run:

```text
TypeError: mediaPath is not a function
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/02-media-contracts.md 3
```

Expected: 4 lines starting with `wrote`, one for each file below.

### Create `packages/contracts/src/media.ts`

```ts
import { z } from "zod";

/** Every code the media endpoints add to ErrorEnvelope.error.code (plus the shared ones: invalid_request, not_found, rate_limited). */
export const MediaErrorCode = z.enum(["unsupported_media_type", "file_too_large", "too_many_pending_uploads", "uploads_unavailable", "media_unavailable"]);
export type MediaErrorCode = z.infer<typeof MediaErrorCode>;

/** Why processing an upload failed. Reported on the status response, not as an HTTP error. */
export const MediaFailure = z.enum(["unsupported_format", "animated_not_supported", "image_too_large", "corrupt_image", "processing_failed"]);
export type MediaFailure = z.infer<typeof MediaFailure>;

/** 20 MiB. The API counts bytes while it streams an upload to disk and stops here. */
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PER_POST = 4;
/** The types an upload may declare. The bytes decide; the declaration is checked and then forgotten. */
export const MEDIA_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"] as const;
export type MediaAcceptedType = (typeof MEDIA_ACCEPTED_TYPES)[number];
export const ALT_MAX_LENGTH = 1000;

export const MediaId = z.uuid();

export const MEDIA_SIZES = ["small", "large"] as const;
export type MediaSize = (typeof MEDIA_SIZES)[number];

/** Where an image file is served. Views carry these paths, so the server can move images without a client change. */
export function mediaPath(id: string, size: MediaSize): string {
  return `/api/media/${id}/${size}.webp`;
}

/** Length in code points, which is what Postgres char_length counts. */
export function altLength(alt: string): number {
  return Array.from(alt).length;
}

/** Unicode NFC, every run of whitespace (line breaks included) to one space, trimmed. The server and the composer use the same rule. */
export function normalizeAltText(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const CONTROL = /\p{Cc}/u;

/** An image description as stored: normalized, 1 to 1000 code points, no control characters. */
export const AltText = z
  .string()
  .max(4000)
  .transform(normalizeAltText)
  .refine((alt) => !CONTROL.test(alt), { message: "control characters are not allowed" })
  .refine((alt) => altLength(alt) >= 1, { message: "every image needs a description" })
  .refine((alt) => altLength(alt) <= ALT_MAX_LENGTH, { message: `descriptions have at most ${ALT_MAX_LENGTH} characters` });

/** One image of a new post: an upload that is ready, and its description. */
export const MediaAttachment = z.object({ id: MediaId, alt: AltText });
export type MediaAttachment = z.infer<typeof MediaAttachment>;

export const UploadResponse = z.object({ id: MediaId, status: z.literal("processing") });
export type UploadResponse = z.infer<typeof UploadResponse>;

/** The state of one upload, for its owner. Width and height are those of the large size, after rotation. */
export const MediaStatusResponse = z.discriminatedUnion("status", [
  z.object({ id: MediaId, status: z.literal("processing") }),
  z.object({ id: MediaId, status: z.literal("ready"), width: z.number().int().positive(), height: z.number().int().positive(), blurhash: z.string().min(6) }),
  z.object({ id: MediaId, status: z.literal("failed"), error: MediaFailure }),
]);
export type MediaStatusResponse = z.infer<typeof MediaStatusResponse>;

/** An image on a post, as every reader gets it. */
export const MediaView = z.object({
  id: MediaId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().min(6),
  alt: z.string(),
  small: z.string(),
  large: z.string(),
});
export type MediaView = z.infer<typeof MediaView>;
```

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { MediaView } from "./media";

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
  /** The post's images in order. Always present, often empty. */
  media: z.array(MediaView),
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
```

### Replace `packages/contracts/src/index.ts` (whole file)

```ts
import { z } from "zod";

/** Every non-2xx response from the API has this shape. */
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const CheckState = z.enum(["ok", "fail"]);

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  checks: z.record(z.string(), CheckState),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Keyset pagination query params shared by every list endpoint. */
export const Pagination = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type Pagination = z.infer<typeof Pagination>;

export * from "./auth";
export * from "./media";
export * from "./social";
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow, SocialRepo } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** What a post id resolves to for a viewer: the view, or a tombstone when the viewer may not see it. */
export type LoadedPost = PostView | Tombstone;

export function isTombstone(loaded: LoadedPost): loaded is Tombstone {
  return !("author" in loaded);
}

export function authorOf(profile: ProfileRow): Author {
  return { id: profile.id, handle: profile.handle, displayName: profile.displayName, verified: profile.verified };
}

/**
 * Turns post ids into views for one viewer: loads the rows and, one level deep, the posts they
 * quote; decides access for every row with the visibility rule and the viewer's blocks; attaches
 * the viewer's like, repost and bookmark state. Ids that resolve to nothing become tombstones.
 */
export async function loadPostViews(repo: SocialRepo, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].map((row) => row.authorId))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: row.replyToHandle ?? "" } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    // Filled by the media module once posts can carry images.
    media: [],
    ...(states ? { viewer: states.get(row.id)! } : {}),
  });
  const quoteOf = (id: string | null): PostView["quoteOf"] => {
    if (id === null) return null;
    const row = all.get(id);
    if (!row) return tombstone(id, "hidden");
    const a = access(row);
    return a === "shown" ? { ...base(row), quoteOf: null } : tombstone(id, a);
  };

  const out = new Map<string, LoadedPost>();
  for (const id of unique) {
    const row = primary.get(id);
    if (!row) {
      out.set(id, tombstone(id, "hidden"));
      continue;
    }
    const a = access(row);
    out.set(id, a === "shown" ? { ...base(row), quoteOf: quoteOf(row.quoteOfId) } : tombstone(id, a));
  }
  return out;
}

/** One post as the viewer sees it, or null when they may not. */
export async function postView(repo: SocialRepo, viewer: ViewerId, id: string): Promise<PostView | null> {
  const loaded = (await loadPostViews(repo, viewer, [id])).get(id)!;
  return isTombstone(loaded) ? null : loaded;
}

/** Views for list rows, in list order, dropping anything the viewer may not see. */
export async function postViews(repo: SocialRepo, viewer: ViewerId, rows: ListRow[]): Promise<PostView[]> {
  const loaded = await loadPostViews(repo, viewer, rows.map((row) => row.postId));
  return rows.map((row) => loaded.get(row.postId)!).filter((view): view is PostView => !isTombstone(view));
}

/** Timeline items for list rows, with the reposter attached to repost rows. */
export async function timelineItems(repo: SocialRepo, viewer: ViewerId, rows: ListRow[]): Promise<TimelineItem[]> {
  const loaded = await loadPostViews(repo, viewer, rows.map((row) => row.postId));
  const reposters = await repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
  const items: TimelineItem[] = [];
  for (const row of rows) {
    const view = loaded.get(row.postId)!;
    if (isTombstone(view)) continue;
    const reposter = row.reposterId ? reposters.get(row.reposterId) : undefined;
    if (row.reposterId && !reposter) continue;
    items.push(reposter ? { kind: "repost", post: view, repostedBy: authorOf(reposter), repostedAt: row.sortAt.toISOString() } : { kind: "post", post: view });
  }
  return items;
}

/** The cursor for the page after these rows, or null when the page was not full. */
export function pageCursor(rows: { sortAt: Date; postId?: string; profileId?: string; reposterId?: string | null }[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor({ t: last.sortAt.getTime(), id: (last.postId ?? last.profileId)!, ...(last.reposterId ? { r: last.reposterId } : {}) });
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/contracts test
```

Expected output contains:

- `Tests  40 passed (40)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  40 passed (40)
```

## Step 5: verify: typecheck-contracts

```bash
pnpm --filter @korbat/contracts typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: typecheck-api

```bash
pnpm --filter @korbat/api typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 7: verify: typecheck-app

```bash
pnpm --filter @korbat/app typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 8: verify: api-test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  114 passed | 96 skipped (210)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  114 passed | 96 skipped (210)
```

## Step 9: verify: integration

```bash
pnpm --filter @korbat/api test:integration
```

Expected output contains:

- `Tests  96 passed (96)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  96 passed (96)
```

## Step 10: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/views.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/media.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/media.test.ts`
- `packages/contracts/test/social.test.ts`

## Step 11: commit

```bash
git add -A
git commit -q -m "feat(contracts): media limits, alt text rule, upload and status responses, media views; every post view carries a media list" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(contracts): media limits, alt text rule, upload and status responses, media views; every post view carries a media list`.

## Report format (mandatory)

```text
TASK 2 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck-contracts": <paste the expected lines as printed>
Verify "typecheck-api": <paste the expected lines as printed>
Verify "typecheck-app": <paste the expected lines as printed>
Verify "api-test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
