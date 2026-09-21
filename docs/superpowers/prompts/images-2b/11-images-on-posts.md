# korbat 2b — Task 11 of 17: Images on posts: CreatePostRequest takes up to four described images, the social flows attach and detach them in their own transactions, and every view carries them

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-18 and 2026-09-19 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Posts, replies and quotes take up to four described images. The social flows attach them inside the post's own transaction and detach them when the post is deleted, then ask the worker to delete the files. Every view, in timelines, threads, profiles and quotes, carries the images. A post may be images only; a post with neither text nor images is refused.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This task adds no dependencies: do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(media): image files served after a visibility check, mounted before the global limit and session resolution; canonical media ids; advisory health checks; boundary test covers the media module`.
3. The previous task's integration run ended with `Tests  118 passed (118)`.

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
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/11-images-on-posts.md 1
```

Expected: 5 lines starting with `wrote`, one for each file below.

### Create `apps/api/test/integration/social-media.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostView, mediaPath } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { serve } from "../../src/media/flows/serve";
import { upload } from "../../src/media/flows/upload";
import { setFollow } from "../../src/social/flows/graph";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { followingTimeline, latestTimeline, profilePosts } from "../../src/social/flows/timelines";
import { mediaHarness, type MediaHarness } from "./media-harness";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: images on posts", () => {
  let db: Db;
  let m: MediaHarness;
  let s: SocialHarness;

  beforeAll(async () => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    m = await mediaHarness(db);
    s = socialHarness(db, {
      media: {
        attach: (tx, input) => m.deps.repo.attach(tx, input),
        detachAll: (tx, postId) => m.deps.repo.detachAll(tx, postId),
        requestDeletion: (ids) => m.files.requestDeletion(ids),
        forPosts: (postIds) => m.deps.repo.forPosts(postIds),
      },
    });
  });
  afterAll(async () => {
    m.cleanup();
    await closeDb(db);
  });

  const image = (id: string, alt: string) => ({ id, alt });
  const page = { limit: 50 };

  test("a post carries its images in order, with sizes, a placeholder, a description and both paths", async () => {
    const ada = await s.established();
    const [first, second] = [await m.readyImage(ada.id, { width: 1600, height: 1200 }), await m.readyImage(ada.id, { width: 900, height: 1600 })];
    const post = PostView.parse(await createPost(s.deps, ada.id, { body: "two photos", media: [image(first, "a harbour at dawn"), image(second, "a lighthouse")] }));
    expect(post.media).toEqual([
      { id: first, width: 1600, height: 1200, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a harbour at dawn", small: mediaPath(first, "small"), large: mediaPath(first, "large") },
      { id: second, width: 900, height: 1600, blurhash: "L2Eo_P_3jb_3~qoL", alt: "a lighthouse", small: mediaPath(second, "small"), large: mediaPath(second, "large") },
    ]);
    expect((await m.deps.repo.find(first))?.postId).toBe(post.id);
    expect((await getPost(s.deps, null, post.id)).media.map((item) => item.id)).toEqual([first, second]);
  });

  test("a post may consist of images only, and replies and quotes carry images too", async () => {
    const ada = await s.established();
    const root = await createPost(s.deps, ada.id, { body: "", media: [image(await m.readyImage(ada.id), "only an image")] });
    expect(root).toMatchObject({ body: "", media: [{ alt: "only an image" }] });
    const reply = await createPost(s.deps, ada.id, { body: "and one more", replyToId: root.id, media: [image(await m.readyImage(ada.id), "a reply image")] });
    const quote = await createPost(s.deps, ada.id, { body: "look at this", quoteOfId: root.id, media: [] });
    expect(reply.media).toHaveLength(1);
    expect(quote.quoteOf).toMatchObject({ id: root.id, media: [{ alt: "only an image" }] });
    const opened = await thread(s.deps, null, reply.id, page);
    expect(opened.ancestors[0]).toMatchObject({ id: root.id, media: [{ alt: "only an image" }] });
    expect((await thread(s.deps, null, root.id, page)).replies.items[0]).toMatchObject({ id: reply.id, media: [{ alt: "a reply image" }] });
  });

  test("only your own ready image that is on no post can be attached, and a refused image means no post", async () => {
    const [ada, bob] = await Promise.all([s.established(), s.established()]);
    const bobs = await m.readyImage(bob.id);
    const processing = (await upload(m.deps, ada.id, m.jpeg())).id;
    const used = await m.readyImage(ada.id);
    await createPost(s.deps, ada.id, { body: "first use", media: [image(used, "used once")] });
    const before = (await profilePosts(s.deps, null, ada.handle, page)).items.length;

    for (const id of [bobs, processing, used, m.newId()]) {
      expect(await rejection(createPost(s.deps, ada.id, { body: "should not exist", media: [image(id, "x")] })), id).toBe("media_unavailable");
    }
    const good = await m.readyImage(ada.id);
    expect(await rejection(createPost(s.deps, ada.id, { body: "half good", media: [image(good, "fine"), image(bobs, "not mine")] }))).toBe("media_unavailable");
    expect((await m.deps.repo.find(good))?.postId).toBeNull();
    expect((await profilePosts(s.deps, null, ada.handle, page)).items.length).toBe(before);
    expect((await createPost(s.deps, ada.id, { body: "now it works", media: [image(good, "fine")] })).media).toHaveLength(1);
  });

  test("timelines, profiles and threads all carry images, and reposts show the original's", async () => {
    const [viewer, ada] = await Promise.all([s.established(), s.established()]);
    await setFollow(s.deps, viewer.id, ada.handle, true);
    const post = await createPost(s.deps, ada.id, { body: "in every list", media: [image(await m.readyImage(ada.id), "a list image")] });
    const expected = [{ alt: "a list image" }];
    expect((await followingTimeline(s.deps, viewer.id, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    expect((await latestTimeline(s.deps, null, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    expect((await profilePosts(s.deps, null, ada.handle, page)).items.find((item) => item.post.id === post.id)?.post.media).toMatchObject(expected);
    const plain = await createPost(s.deps, ada.id, { body: "no images here", media: [] });
    expect(plain.media).toEqual([]);
  });

  test("deleting a post removes its image rows, asks for the files to be deleted, and the files stop being served at once", async () => {
    const ada = await s.established();
    const ids = [await m.readyImage(ada.id), await m.readyImage(ada.id)];
    const post = await createPost(s.deps, ada.id, { body: "short lived", media: ids.map((id) => image(id, "soon gone")) });
    const asked = () => serve(m.deps, { id: ids[0]!, size: "large", ifNoneMatch: undefined, viewer: async () => ada.id });
    const served = await asked();
    expect(served.kind).toBe("file");
    if (served.kind === "file") await served.file.handle.close();

    await deletePost(s.deps, ada.id, post.id);
    expect(await m.deps.repo.find(ids[0]!)).toBeNull();
    expect(await m.deps.repo.find(ids[1]!)).toBeNull();
    expect((await m.files.deletionRequests()).sort()).toEqual(expect.arrayContaining([...ids].sort()));
    expect((await asked()).kind).toBe("not_found");
    expect(await rejection(getPost(s.deps, ada.id, post.id))).toBe("not_found");
  });

  test("without a media module posts carry no images and attaching one is refused", async () => {
    const plain = socialHarness(db);
    const ada = await plain.established();
    expect((await createPost(plain.deps, ada.id, { body: "text only", media: [] })).media).toEqual([]);
    expect(await rejection(createPost(plain.deps, ada.id, { body: "with an image", media: [image(m.newId(), "x")] }))).toBe("media_unavailable");
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

```

### Replace `apps/api/test/integration/social-harness.ts` (whole file)

```ts
import pino from "pino";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { MediaForPosts } from "../../src/media";
import { WITHOUT_MEDIA, type SocialDeps } from "../../src/social/context";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newProfile, ticker } from "./social-fixtures";

/**
 * Real repository on Postgres, in-memory limits, and a clock the test moves. Every read of the
 * clock by a flow advances it one millisecond, so consecutive actions never share a timestamp and
 * list order in the tests is never left to the tie-breaker.
 */
export function socialHarness(db: Db, options: { media?: MediaForPosts } = {}) {
  const clock = ticker();
  const repo = createSocialRepo(db);
  const deps: SocialDeps = { repo, media: options.media ?? WITHOUT_MEDIA, limits: new MemoryStore(() => clock.now().getTime()), log: pino({ level: "silent" }), now: clock.next };
  return {
    deps,
    repo,
    clock,
    /** An account old enough for every action. */
    established: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - 3 * DAY_MS) }),
    /** An account in its first day. */
    fresh: () => newProfile(db, { createdAt: new Date(clock.now().getTime() - HOUR_MS) }),
  };
}

export type SocialHarness = ReturnType<typeof socialHarness>;

/** The error code a flow rejects with, or null when it succeeds. */
export async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code);
    throw err;
  }
}
```

### Replace `apps/api/test/integration/social-flows-posts.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { PostView, ThreadResponse } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { createPost, deletePost, getPost, thread } from "../../src/social/flows/posts";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: post and engagement flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };

  test("posts, replies and quotes come back as views that pass the contract", async () => {
    const ada = await h.established();
    const root = await post(ada.id, "first");
    expect(PostView.parse(root)).toMatchObject({ body: "first", replyTo: null, quoteOf: null, counts: { likes: 0, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: false, reposted: false, bookmarked: false } });
    expect(root.author).toEqual({ id: ada.id, handle: ada.handle, displayName: expect.any(String), verified: false });

    const reply = await post(ada.id, "second", { replyToId: root.id });
    expect(reply.replyTo).toEqual({ id: root.id, authorHandle: ada.handle });
    const quote = await post(ada.id, "third", { quoteOfId: root.id });
    expect(quote.quoteOf).toMatchObject({ id: root.id, body: "first", quoteOf: null });
    const quoteOfQuote = await post(ada.id, "fourth", { quoteOfId: quote.id });
    expect(quoteOfQuote.quoteOf).toMatchObject({ id: quote.id, quoteOf: null });
    expect(PostView.parse(quoteOfQuote).quoteOf).not.toHaveProperty("author.email");
    expect((await getPost(h.deps, null, root.id)).viewer).toBeUndefined();
    expect((await getPost(h.deps, ada.id, root.id)).counts).toEqual({ likes: 0, reposts: 0, replies: 1, quotes: 1 });
  });

  test("replying to or quoting a post you may not see is post_unavailable, and blocked when you blocked its author", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "target");
    await h.repo.deletePost(target.id, ada.id, h.clock.next());
    expect(await rejection(post(bob.id, "late", { replyToId: target.id }))).toBe("post_unavailable");

    const withheld = await post(ada.id, "withheld");
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld.id}::uuid`);
    expect(await rejection(post(bob.id, "reply", { quoteOfId: withheld.id }))).toBe("post_unavailable");
    expect(await rejection(post(ada.id, "own reply", { replyToId: withheld.id }))).toBeNull();

    const visible = await post(ada.id, "visible");
    await h.repo.block(ada.id, bob.id, h.clock.next());
    expect(await rejection(post(bob.id, "reply", { replyToId: visible.id }))).toBe("post_unavailable");
    await h.repo.block(carol.id, ada.id, h.clock.next());
    expect(await rejection(post(carol.id, "quote", { quoteOfId: visible.id }))).toBe("blocked");
  });

  test("write limits: a new account gets five posts an hour and no quotes before 48 hours", async () => {
    const [young, ada] = await Promise.all([h.fresh(), h.established()]);
    const target = await post(ada.id, "quotable");
    for (let i = 0; i < 5; i++) expect(await rejection(post(young.id, `post ${i}`))).toBeNull();
    expect(await rejection(post(young.id, "one too many"))).toBe("rate_limited");
    expect(await rejection(post(young.id, "reply still fine", { replyToId: target.id }))).toBeNull();
    expect(await rejection(post(young.id, "quote", { quoteOfId: target.id }))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "repost", true))).toBe("account_too_new");
    expect(await rejection(setEngagement(h.deps, young.id, target.id, "like", true))).toBeNull();
  });

  test("deletion: author only, blanks the body, and leaves tombstones as ancestor and quote", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const reply = await post(bob.id, "reply", { replyToId: root.id });
    const quote = await post(bob.id, "quote", { quoteOfId: root.id });
    expect(await rejection(deletePost(h.deps, bob.id, root.id))).toBe("not_author");
    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(deletePost(h.deps, carol.id, root.id))).toBe("not_found");

    await deletePost(h.deps, ada.id, root.id);
    await deletePost(h.deps, ada.id, root.id);
    expect(await rejection(getPost(h.deps, ada.id, root.id))).toBe("not_found");
    const viewed = await thread(h.deps, null, reply.id, { limit: 20 });
    expect(viewed.ancestors).toEqual([{ id: root.id, deleted: true }]);
    expect((await getPost(h.deps, null, quote.id)).quoteOf).toEqual({ id: root.id, deleted: true });
    const [row] = (await db.execute(sql`select body, state from posts where id = ${root.id}::uuid`)) as unknown as { body: string; state: string }[];
    expect(row).toEqual({ body: "", state: "deleted_by_author" });
  });

  test("threads: ancestors root first with unavailable tombstones, replies page oldest first", async () => {
    const [ada, bob, viewer] = await Promise.all([h.established(), h.established(), h.established()]);
    const root = await post(ada.id, "root");
    const mid = await post(bob.id, "mid", { replyToId: root.id });
    const leaf = await post(ada.id, "leaf", { replyToId: mid.id });
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push(await post(bob.id, `r${i}`, { replyToId: leaf.id }));
    const hidden = await post(ada.id, "hidden reply", { replyToId: leaf.id });
    await db.execute(sql`update posts set state = 'removed' where id = ${hidden.id}::uuid`);

    const first = ThreadResponse.parse(await thread(h.deps, viewer.id, leaf.id, { limit: 2 }));
    expect(first.ancestors.map((a) => a.id)).toEqual([root.id, mid.id]);
    expect(first.replies.items.map((r) => r.body)).toEqual(["r0", "r1"]);
    expect(first.replies.nextCursor).not.toBeNull();
    const second = await thread(h.deps, viewer.id, leaf.id, { limit: 2, cursor: first.replies.nextCursor! });
    expect(second.replies.items.map((r) => r.body)).toEqual(["r2"]);
    expect(second.replies.nextCursor).toBeNull();

    await h.repo.block(bob.id, viewer.id, h.clock.next());
    const blockedView = await thread(h.deps, viewer.id, leaf.id, { limit: 20 });
    expect(blockedView.ancestors).toEqual([expect.objectContaining({ id: root.id, body: "root" }), { id: mid.id, unavailable: true }]);
    expect(blockedView.replies.items).toEqual([]);
    expect((await thread(h.deps, ada.id, leaf.id, { limit: 20 })).replies.items.map((r) => r.body)).toEqual(["r0", "r1", "r2", "hidden reply"]);
  });

  test("likes, reposts and bookmarks are idempotent, honour blocks in both directions, and undo without limits", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    const target = await post(ada.id, "engage");
    expect(await setEngagement(h.deps, bob.id, target.id, "like", true)).toEqual({ counts: { likes: 1, reposts: 0, replies: 0, quotes: 0 }, viewer: { liked: true, reposted: false, bookmarked: false } });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", true)).counts.likes).toBe(1);
    expect((await setEngagement(h.deps, bob.id, target.id, "bookmark", true)).counts).toEqual({ likes: 1, reposts: 0, replies: 0, quotes: 0 });
    expect((await setEngagement(h.deps, bob.id, target.id, "repost", true)).viewer).toEqual({ liked: true, reposted: true, bookmarked: true });
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).counts.likes).toBe(0);
    expect((await setEngagement(h.deps, bob.id, target.id, "like", false)).viewer.liked).toBe(false);

    await h.repo.block(ada.id, carol.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, carol.id, target.id, "like", true))).toBe("not_found");
    await h.repo.block(bob.id, ada.id, h.clock.next());
    expect(await rejection(setEngagement(h.deps, bob.id, target.id, "like", true))).toBe("blocked");
    expect(await rejection(setEngagement(h.deps, bob.id, target.id, "repost", false))).toBe("blocked");
  });
});
```

### Replace `apps/api/test/integration/social-flows-graph.test.ts` (whole file)

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProfilePage, ProfileView, TimelinePage } from "@korbat/contracts";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { setEngagement } from "../../src/social/flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "../../src/social/flows/graph";
import { createPost } from "../../src/social/flows/posts";
import { followers, following, profile } from "../../src/social/flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "../../src/social/flows/timelines";
import { rejection, socialHarness, type SocialHarness } from "./social-harness";

describe.skipIf(!process.env.INTEGRATION)("integration: graph, profile and timeline flows", () => {
  let db: Db;
  let h: SocialHarness;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    h = socialHarness(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  const post = (viewer: string, body: string, extra: { replyToId?: string; quoteOfId?: string } = {}) => {
    h.clock.next();
    return createPost(h.deps, viewer, { body, media: [], ...extra });
  };
  const page = { limit: 20 };

  test("follow and unfollow keep counts, refuse yourself, and are directional across a block", async () => {
    const [ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established()]);
    expect(await setFollow(h.deps, ada.id, bob.handle, true)).toEqual({ following: true, followerCount: 1 });
    expect(await setFollow(h.deps, ada.id, `@${bob.handle.toUpperCase()}`, true)).toEqual({ following: true, followerCount: 1 });
    expect(await rejection(setFollow(h.deps, ada.id, ada.handle, true))).toBe("self_target");
    expect(await rejection(setFollow(h.deps, ada.id, "nobody_here_404", true))).toBe("not_found");

    const view = ProfileView.parse(await profile(h.deps, ada.id, bob.handle));
    expect(view.counts).toEqual({ posts: 0, followers: 1, following: 0 });
    expect(view.viewer).toEqual({ following: true, followedBy: false, blocked: false, muted: false });
    expect((await profile(h.deps, null, bob.handle)).viewer).toBeUndefined();
    expect((await profile(h.deps, bob.id, bob.handle)).viewer).toBeUndefined();

    await setBlock(h.deps, carol.id, ada.handle, true);
    expect(await rejection(setFollow(h.deps, ada.id, carol.handle, true))).toBe("not_found");
    expect(await rejection(setFollow(h.deps, carol.id, ada.handle, true))).toBe("blocked");
    expect(await setFollow(h.deps, ada.id, bob.handle, false)).toEqual({ following: false, followerCount: 0 });
  });

  test("blocking hides the profile both ways, removes follows, and unblocking restores visibility only", async () => {
    const [ada, bob] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, ada.id, bob.handle, true);
    await setFollow(h.deps, bob.id, ada.handle, true);
    expect(await setBlock(h.deps, ada.id, bob.handle, true)).toEqual({ blocked: true });
    expect(await rejection(profile(h.deps, ada.id, bob.handle))).toBe("not_found");
    expect(await rejection(profile(h.deps, bob.id, ada.handle))).toBe("not_found");
    expect((await profile(h.deps, null, ada.handle)).counts.followers).toBe(0);
    expect((await blockedList(h.deps, ada.id, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    expect(await rejection(setBlock(h.deps, ada.id, ada.handle, true))).toBe("self_target");

    expect(await setBlock(h.deps, ada.id, bob.handle, false)).toEqual({ blocked: false });
    expect((await profile(h.deps, bob.id, ada.handle)).viewer).toEqual({ following: false, followedBy: false, blocked: false, muted: false });
    expect((await blockedList(h.deps, ada.id, page)).items).toEqual([]);
  });

  test("mutes are silent, listed for their owner, and hide timelines only", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const a1 = await post(ada.id, "muted soon");
    expect(await setMute(h.deps, viewer.id, ada.handle, true)).toEqual({ muted: true });
    expect((await profile(h.deps, viewer.id, ada.handle)).viewer?.muted).toBe(true);
    expect((await profile(h.deps, ada.id, viewer.handle)).viewer).toEqual({ following: false, followedBy: true, blocked: false, muted: false });
    expect((await mutedList(h.deps, viewer.id, page)).items.map((i) => i.id)).toEqual([ada.id]);
    expect((await followingTimeline(h.deps, viewer.id, page)).items).toEqual([]);
    expect((await profilePosts(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
    expect(await setMute(h.deps, viewer.id, ada.handle, false)).toEqual({ muted: false });
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("follower and following lists need a viewer, mark who the viewer follows, and hide blocked accounts", async () => {
    const [viewer, ada, bob, carol] = await Promise.all([h.established(), h.established(), h.established(), h.established()]);
    await setFollow(h.deps, bob.id, ada.handle, true);
    await setFollow(h.deps, carol.id, ada.handle, true);
    await setFollow(h.deps, viewer.id, bob.handle, true);
    const list = ProfilePage.parse(await followers(h.deps, viewer.id, ada.handle, page));
    expect(list.items.map((i) => [i.handle, i.viewerFollows])).toEqual([
      [carol.handle, false],
      [bob.handle, true],
    ]);
    expect((await following(h.deps, viewer.id, bob.handle, page)).items.map((i) => i.handle)).toEqual([ada.handle]);

    await setBlock(h.deps, carol.id, viewer.handle, true);
    expect((await followers(h.deps, viewer.id, ada.handle, page)).items.map((i) => i.handle)).toEqual([bob.handle]);
    const one = await followers(h.deps, ada.id, ada.handle, { limit: 1 });
    expect(one.items).toHaveLength(1);
    expect(one.nextCursor).not.toBeNull();
    expect((await followers(h.deps, ada.id, ada.handle, { limit: 1, cursor: one.nextCursor! })).items.map((i) => i.handle)).toEqual([bob.handle]);
  });

  test("timelines: following carries reposts with the reposter, latest is public, profiles split posts and replies", async () => {
    const [viewer, ada, bob] = await Promise.all([h.established(), h.established(), h.established()]);
    await setFollow(h.deps, viewer.id, ada.handle, true);
    const b1 = await post(bob.id, "from bob");
    const a1 = await post(ada.id, "from ada");
    await post(ada.id, "a reply", { replyToId: b1.id });
    h.clock.next();
    await setEngagement(h.deps, ada.id, b1.id, "repost", true);

    const feed = TimelinePage.parse(await followingTimeline(h.deps, viewer.id, page));
    expect(feed.items.map((i) => (i.kind === "repost" ? ["repost", i.post.id, i.repostedBy.handle] : ["post", i.post.id]))).toEqual([
      ["repost", b1.id, ada.handle],
      ["post", a1.id],
    ]);
    expect(feed.items[0]!.post.viewer).toEqual({ liked: false, reposted: false, bookmarked: false });

    const latest = TimelinePage.parse(await latestTimeline(h.deps, null, { limit: 50 }));
    expect(latest.items.map((i) => i.post.id)).toEqual(expect.arrayContaining([a1.id, b1.id]));
    expect(latest.items.every((i) => i.kind === "post" && i.post.viewer === undefined)).toBe(true);

    expect((await profilePosts(h.deps, null, ada.handle, page)).items.map((i) => i.kind)).toEqual(["repost", "post"]);
    expect((await profileReplies(h.deps, null, ada.handle, page)).items.map((i) => i.body)).toEqual(["a reply"]);
    await setBlock(h.deps, bob.id, viewer.handle, true);
    expect(await rejection(profilePosts(h.deps, viewer.id, bob.handle, page))).toBe("not_found");
    expect((await followingTimeline(h.deps, viewer.id, page)).items.map((i) => i.post.id)).toEqual([a1.id]);
  });

  test("likes and bookmarks are private pages, newest first, with cursors", async () => {
    const [viewer, ada] = await Promise.all([h.established(), h.established()]);
    const posts = [];
    for (let i = 0; i < 3; i++) posts.push(await post(ada.id, `p${i}`));
    for (const p of posts) {
      h.clock.next();
      await setEngagement(h.deps, viewer.id, p.id, "like", true);
    }
    h.clock.next();
    await setEngagement(h.deps, viewer.id, posts[1]!.id, "bookmark", true);
    const first = await likedPosts(h.deps, viewer.id, { limit: 2 });
    expect(first.items.map((p) => p.body)).toEqual(["p2", "p1"]);
    const second = await likedPosts(h.deps, viewer.id, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((p) => p.body)).toEqual(["p0"]);
    expect(second.nextCursor).toBeNull();
    expect((await bookmarkedPosts(h.deps, viewer.id, page)).items.map((p) => p.body)).toEqual(["p1"]);
    expect(await rejection(likedPosts(h.deps, viewer.id, { limit: 2, cursor: "not-a-cursor" }))).toBe("invalid_request");
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/contracts test
```

Expected: the command exits with an error, and the output contains:

- `Tests  3 failed | 41 passed (44)`

Observed on the dry run:

```text
Tests  3 failed | 41 passed (44)
```

## Step 3: write the implementation

```bash
python docs/superpowers/prompts/images-2b/write_blocks.py docs/superpowers/prompts/images-2b/11-images-on-posts.md 3
```

Expected: 13 lines starting with `wrote`, one for each file below.

### Replace `packages/contracts/src/social.ts` (whole file)

```ts
import { z } from "zod";
import { MEDIA_MAX_PER_POST, MediaAttachment, MediaView } from "./media";

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

/** The text of a post that may also carry images: the same rule as PostBody, except that it may be empty. */
export const PostText = z
  .string()
  .max(4000)
  .transform(normalizePostBody)
  .refine((body) => !FORBIDDEN_CONTROL.test(body), { message: "control characters are not allowed" })
  .refine((body) => postLength(body) <= POST_MAX_LENGTH, { message: `posts have at most ${POST_MAX_LENGTH} characters` });

/** A new post, reply or quote: text, up to four images that are ready, or both. */
export const CreatePostRequest = z
  .object({
    body: PostText.default(""),
    replyToId: PostId.optional(),
    quoteOfId: PostId.optional(),
    media: z.array(MediaAttachment).max(MEDIA_MAX_PER_POST).default([]),
  })
  .refine((post) => !(post.replyToId && post.quoteOfId), { message: "a post is a reply or a quote, not both", path: ["quoteOfId"] })
  .refine((post) => postLength(post.body) >= 1 || post.media.length >= 1, { message: "a post needs text or an image", path: ["body"] })
  .refine((post) => new Set(post.media.map((item) => item.id)).size === post.media.length, { message: "an image can be attached once", path: ["media"] });
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

### Replace `packages/db/src/index.ts` (whole file)

```ts
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * from "./schema/index";
export { schema };

export type Db = ReturnType<typeof createDb>;
/** A transaction opened on a Db. Modules pass it on so that several of them can write in one transaction. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(url: string, opts: { max?: number } = {}) {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return drizzle(client, { schema });
}

export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
```

### Replace `apps/api/src/media/context.ts` (whole file)

```ts
import type { MediaAttachment, MediaErrorCode, MediaView } from "@korbat/contracts";
import type { DbTx } from "@korbat/db";
import type { MediaFormat } from "@korbat/media-protocol";
import type { Logger } from "pino";
import type { MediaFiles } from "./files";
import type { MediaRepo } from "./repo";

/** The media codes plus the shared ones the module also raises. */
export type MediaErrorKind = MediaErrorCode | "not_found" | "invalid_request";
export type MediaErrorStatus = 400 | 404 | 409 | 413 | 415 | 503;

const MESSAGES: Record<MediaErrorKind, string> = {
  unsupported_media_type: "That file type is not supported. Use a JPEG, PNG, WebP, AVIF or GIF image.",
  file_too_large: "Images can be at most 20 MB.",
  too_many_pending_uploads: "You have too many images waiting to be posted. Post or remove some first.",
  uploads_unavailable: "Image uploads are temporarily unavailable. Try again later.",
  media_unavailable: "One of the images is not available. Remove it and add it again.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
};

/** What an iPhone calls a photo. The decoder cannot read it, so the message says what to do instead. */
export const HEIC_MESSAGE = "HEIC photos are not supported. Export the photo as JPEG and try again.";

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorKind,
    readonly status: MediaErrorStatus,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function mediaErrorMessage(code: MediaErrorKind): string {
  return MESSAGES[code];
}

/**
 * What the social module needs from this one. `attach` and `detachAll` run inside the social
 * module's own transaction; `requestDeletion` runs after it committed, because files cannot be
 * rolled back.
 */
export interface MediaForPosts {
  attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly MediaAttachment[] }): Promise<void>;
  detachAll(tx: DbTx, postId: string): Promise<string[]>;
  requestDeletion(ids: readonly string[]): Promise<void>;
  forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>>;
}

/** How many uploads one account may hold that are not on a post yet. */
export const MAX_PENDING_UPLOADS = 20;

export interface MediaDeps {
  repo: MediaRepo;
  files: MediaFiles;
  /** The formats MEDIA_FORMATS enables. The worker reads the same setting. */
  formats: readonly MediaFormat[];
  /** Uploads are refused while either volume has less free space than this. */
  minFreeBytes: number;
  /** Counts one upload against the account's hourly limit and throws when it is used up. */
  enforceUploadLimit: (userId: string, accountCreatedAt: Date, now: Date) => Promise<void>;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/media/repo.ts` (whole file)

```ts
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { mediaPath, type MediaView } from "@korbat/contracts";
import { postMedia, posts, profiles, type Db, type DbTx } from "@korbat/db";
import type { ResultFile } from "@korbat/media-protocol";
import { MediaError } from "./context";

/** Every SQL statement on post_media lives in this module's repository, on the korbat_api pool. */

export interface MediaRow {
  id: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  error: string | null;
  postId: string | null;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  createdAt: Date;
}

const columns = {
  id: postMedia.id,
  ownerId: postMedia.ownerId,
  status: postMedia.status,
  error: postMedia.error,
  postId: postMedia.postId,
  width: postMedia.width,
  height: postMedia.height,
  blurhash: postMedia.blurhash,
  createdAt: postMedia.createdAt,
};

export function createMediaRepo(db: Db) {
  return {
    /** When the account was onboarded, which decides its upload tier. */
    async accountCreatedAt(userId: string): Promise<Date | null> {
      const rows = await db.select({ createdAt: profiles.createdAt }).from(profiles).where(eq(profiles.id, userId)).limit(1);
      return rows[0]?.createdAt ?? null;
    },

    /** Uploads of this account that are not on a post yet and did not fail. */
    async pendingCount(ownerId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postMedia)
        .where(and(eq(postMedia.ownerId, ownerId), isNull(postMedia.postId), inArray(postMedia.status, ["processing", "ready"])));
      return rows[0]?.count ?? 0;
    },

    async insertProcessing(input: { id: string; ownerId: string; now: Date }): Promise<void> {
      await db.insert(postMedia).values({ id: input.id, ownerId: input.ownerId, status: "processing", createdAt: input.now });
    },

    async find(id: string): Promise<MediaRow | null> {
      const rows = await db.select(columns).from(postMedia).where(eq(postMedia.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Records the worker's verdict, once. A row that is no longer processing is left as it is. */
    async finalize(id: string, result: ResultFile): Promise<boolean> {
      const values = result.status === "ready" ? { status: "ready" as const, width: result.width, height: result.height, blurhash: result.blurhash } : { status: "failed" as const, error: result.reason };
      const rows = await db.update(postMedia).set(values).where(and(eq(postMedia.id, id), eq(postMedia.status, "processing"))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** Removes an upload of this account that is not on a post. */
    async deleteUnattached(id: string, ownerId: string): Promise<boolean> {
      const rows = await db.delete(postMedia).where(and(eq(postMedia.id, id), eq(postMedia.ownerId, ownerId), isNull(postMedia.postId))).returning({ id: postMedia.id });
      return rows.length === 1;
    },

    /** What serving an image file depends on: whether it is ready, and its post's state and author. */
    async fileAccess(id: string): Promise<{ status: MediaRow["status"]; postState: string | null; authorId: string | null } | null> {
      const rows = await db
        .select({ status: postMedia.status, postState: posts.state, authorId: posts.authorId })
        .from(postMedia)
        .leftJoin(posts, eq(posts.id, postMedia.postId))
        .where(eq(postMedia.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Puts images on a post, inside the transaction that creates it. Each must belong to the author,
     * be ready and be on no post yet; anything else rolls the post back.
     */
    async attach(tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }): Promise<void> {
      for (const [position, item] of input.items.entries()) {
        const rows = await tx
          .update(postMedia)
          .set({ postId: input.postId, position, altText: item.alt })
          .where(and(eq(postMedia.id, item.id), eq(postMedia.ownerId, input.ownerId), isNull(postMedia.postId), eq(postMedia.status, "ready")))
          .returning({ id: postMedia.id });
        if (rows.length !== 1) throw new MediaError("media_unavailable", 400);
      }
    },

    /** Removes a post's images, inside the transaction that deletes it, and says which files to delete afterwards. */
    async detachAll(tx: DbTx, postId: string): Promise<string[]> {
      const rows = await tx.delete(postMedia).where(eq(postMedia.postId, postId)).returning({ id: postMedia.id });
      return rows.map((row) => row.id);
    },

    /** The images of a page of posts, in one query, in their order on each post. */
    async forPosts(postIds: readonly string[]): Promise<Map<string, MediaView[]>> {
      const byPost = new Map<string, MediaView[]>();
      if (postIds.length === 0) return byPost;
      const rows = await db
        .select({ id: postMedia.id, postId: postMedia.postId, width: postMedia.width, height: postMedia.height, blurhash: postMedia.blurhash, altText: postMedia.altText })
        .from(postMedia)
        .where(and(inArray(postMedia.postId, [...postIds]), eq(postMedia.status, "ready")))
        .orderBy(postMedia.postId, postMedia.position);
      for (const row of rows) {
        if (!row.postId || row.width === null || row.height === null || row.blurhash === null) continue;
        const view: MediaView = { id: row.id, width: row.width, height: row.height, blurhash: row.blurhash, alt: row.altText ?? "", small: mediaPath(row.id, "small"), large: mediaPath(row.id, "large") };
        byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), view]);
      }
      return byPost;
    },

    /** Removes a row whatever its state. Used when an upload could not be handed to the worker. */
    async deleteRow(id: string): Promise<void> {
      await db.delete(postMedia).where(eq(postMedia.id, id));
    },
  };
}

export type MediaRepo = ReturnType<typeof createMediaRepo>;
```

### Replace `apps/api/src/media/index.ts` (whole file)

```ts
/**
 * The only file outside `src/media/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import { HEARTBEAT_STALE_MS, type MediaFormat } from "@korbat/media-protocol";
import type { AppEnv } from "../env";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { MediaDeps, MediaForPosts } from "./context";
import { createMediaFiles } from "./files";
import { createMediaRepo } from "./repo";
import { mediaFileRoutes, mediaRoutes } from "./routes";

export { MediaError } from "./context";
export type { MediaDeps, MediaForPosts } from "./context";

export interface CreateMediaOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** The uploads volume, which the API writes, and the store volume, which it only reads. */
  uploadsDir: string;
  storeDir: string;
  formats: readonly MediaFormat[];
  minFreeBytes: number;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The auth module's resolveSession. The file routes run it themselves, and only when they must. */
  resolveSession: MiddlewareHandler<AppEnv>;
  /** Image requests have their own per-IP bucket in the store the other limits use. */
  rateLimitStore: RateLimitStore;
  /** Built from the social module's write limits, so every per-account limit lives in one table. */
  enforceUploadLimit: MediaDeps["enforceUploadLimit"];
  now?: () => Date;
}

export function createMedia(options: CreateMediaOptions) {
  const deps: MediaDeps = {
    repo: createMediaRepo(options.apiDb),
    files: createMediaFiles({ uploadsDir: options.uploadsDir, storeDir: options.storeDir, log: options.logger }),
    formats: options.formats,
    minFreeBytes: options.minFreeBytes,
    enforceUploadLimit: options.enforceUploadLimit,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  const forPosts: MediaForPosts = {
    attach: (tx, input) => deps.repo.attach(tx, input),
    detachAll: (tx, postId) => deps.repo.detachAll(tx, postId),
    requestDeletion: (ids) => deps.files.requestDeletion(ids),
    forPosts: (postIds) => deps.repo.forPosts(postIds),
  };
  return {
    deps,
    /** The interface the social module uses to put images on posts and read them back. */
    forPosts,
    /** Creates the uploads volume's directories. Call once before serving. */
    prepare: () => deps.files.prepare(),
    routes: mediaRoutes(deps, options.requireSession),
    /** Mounted before the global rate limit and session resolution. */
    fileRoutes: mediaFileRoutes(deps, { resolveSession: options.resolveSession, rateLimitStore: options.rateLimitStore }),
    /** An advisory health check: the worker's heartbeat is fresh and the volumes have room. */
    async healthCheck(): Promise<void> {
      const age = await deps.files.heartbeatAge(deps.now().getTime());
      if (age === null || age > HEARTBEAT_STALE_MS) throw new Error("the image worker's heartbeat is missing or stale");
      if ((await deps.files.freeBytes()) < deps.minFreeBytes) throw new Error("free space on the media volumes is under the floor");
    },
  };
}

export type Media = ReturnType<typeof createMedia>;
```

### Replace `apps/api/src/social/context.ts` (whole file)

```ts
import type { SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
import { MediaError, type MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import type { SocialRepo } from "./repo";

/** The social codes plus the shared ones the module also raises. */
export type SocialErrorKind = SocialErrorCode | "not_found" | "invalid_request" | "rate_limited";
export type SocialErrorStatus = 400 | 403 | 404 | 429;

const MESSAGES: Record<SocialErrorKind, string> = {
  post_unavailable: "That post is not available to reply to or quote.",
  not_author: "Only the author can delete this post.",
  blocked: "You blocked this account. Unblock it in your privacy settings first.",
  self_target: "You cannot do that to your own account.",
  account_too_new: "New accounts can repost and quote after 48 hours.",
  not_found: "Not found.",
  invalid_request: "Some details are missing or invalid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
};

/** An expected, user-facing failure. The HTTP layer turns it into an ErrorEnvelope with this code and status. */
export class SocialError extends Error {
  constructor(
    readonly code: SocialErrorKind,
    readonly status: SocialErrorStatus,
    message: string = MESSAGES[code],
    /** Set for rate_limited so the response can carry Retry-After. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export function socialErrorMessage(code: SocialErrorKind): string {
  return MESSAGES[code];
}

/** The account making a request, or null when signed out. Reads accept null; writes never do. */
export type ViewerId = string | null;

/** Posts without images: what the module runs with when no media module is wired, as in the 2a tests. */
export const WITHOUT_MEDIA: MediaForPosts = {
  attach: async (_tx, input) => {
    if (input.items.length > 0) throw new MediaError("media_unavailable", 400);
  },
  detachAll: async () => [],
  requestDeletion: async () => undefined,
  forPosts: async () => new Map(),
};

export interface SocialDeps {
  repo: SocialRepo;
  /** Images on posts. The media module owns them; this module only passes its transaction along. */
  media: MediaForPosts;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
```

### Replace `apps/api/src/social/index.ts` (whole file)

```ts
/**
 * The only file outside `src/social/` may import. Everything else in the module is private and the
 * architecture test fails the build if another file reaches into it.
 */
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { Db } from "@korbat/db";
import type { AppEnv } from "../env";
import type { MediaForPosts } from "../media";
import type { RateLimitStore } from "../middleware/rate-limit";
import { WITHOUT_MEDIA, type SocialDeps } from "./context";
import { createSocialRepo } from "./repo";
import { socialRoutes } from "./routes";

export { SocialError } from "./context";
export { enforceWriteLimit } from "./limits";
export type { SocialDeps, ViewerId } from "./context";

export interface CreateSocialOptions {
  /** The korbat_api pool. The module never sees the auth pool. */
  apiDb: Db;
  /** Per-account write limits share the store the per-IP middleware uses. */
  rateLimitStore: RateLimitStore;
  logger: Logger;
  /** The auth module's requireSession: an onboarded account with CSRF and Origin checked. */
  requireSession: MiddlewareHandler<AppEnv>;
  /** The media module's interface for posts. Without it posts carry no images. */
  media?: MediaForPosts;
  now?: () => Date;
}

export function createSocial(options: CreateSocialOptions) {
  const deps: SocialDeps = {
    repo: createSocialRepo(options.apiDb),
    media: options.media ?? WITHOUT_MEDIA,
    limits: options.rateLimitStore,
    log: options.logger,
    now: options.now ?? (() => new Date()),
  };
  return { deps, routes: socialRoutes(deps, options.requireSession) };
}

export type Social = ReturnType<typeof createSocial>;
```

### Replace `apps/api/src/social/repo.ts` (whole file)

```ts
import { and, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, bookmarks, follows, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import type { Cursor } from "./cursor";
import type { StoredPostState } from "./visibility";

/**
 * Every SQL statement of the social module, through the korbat_api pool.
 *
 * Two rules keep the counters and the pagination exact:
 * - every counter changes in the same transaction as the action, by the number of rows the action
 *   really inserted or deleted, so repeating an action never double-counts;
 * - every timestamp is passed in from the clock (millisecond precision) instead of the database
 *   default, so a keyset cursor built from a row round-trips exactly.
 *
 * Reads take the viewer (or null when signed out) and apply the visibility rule in SQL: others see
 * only visible posts, the author also sees their own withheld and removed posts, a block in either
 * direction hides an author entirely, and mutes apply to timelines only.
 *
 * Reads are raw SQL through `db.execute`, which returns timestamps as text and expands a JavaScript
 * array into a parameter list. So timestamps are formatted as ISO text in SQL and parsed once in
 * the row mappers, and id lists travel as one comma-joined parameter split back into a uuid array.
 */

export interface AuthorRow {
  id: string;
  handle: string;
  displayName: string;
  verified: boolean;
}

export interface PostRow {
  id: string;
  authorId: string;
  body: string;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  createdAt: Date;
  deletedAt: Date | null;
  author: AuthorRow;
  replyToHandle: string | null;
}

/** One line of a list: which post, when it sorts, and who reposted it (timelines only). */
export interface ListRow {
  postId: string;
  sortAt: Date;
  reposterId: string | null;
}

export interface ProfileRow {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  verified: boolean;
  followerCount: number;
  followingCount: number;
  postCount: number;
  createdAt: Date;
}

export interface Relation {
  following: boolean;
  followedBy: boolean;
  /** The viewer blocks the other account. */
  blocked: boolean;
  /** The other account blocks the viewer. */
  blockedBy: boolean;
  muted: boolean;
}

export interface ViewerPostRow {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
}

export interface ProfileListRow {
  profileId: string;
  sortAt: Date;
}

export const MAX_ANCESTORS = 50;
const NO_REPOSTER = "00000000-0000-0000-0000-000000000000";

interface RawPost {
  id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  state: StoredPostState;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  created_at: string;
  deleted_at: string | null;
  author_handle: string;
  author_display_name: string;
  author_verified: boolean;
  reply_to_handle: string | null;
}

interface RawListRow {
  post_id: string;
  sort_at: string;
  reposter_id: string | null;
}

interface RawProfileListRow {
  profile_id: string;
  sort_at: string;
}

interface RawProfile {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  verified: boolean;
  follower_count: number;
  following_count: number;
  post_count: number;
  created_at: string;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** A list of ids as one parameter, split into a uuid array in SQL. */
const uuidArray = (ids: string[]): SQL => sql`string_to_array(${ids.join(",")}, ',')::uuid[]`;

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  body: r.body,
  replyToId: r.reply_to_id,
  quoteOfId: r.quote_of_id,
  state: r.state,
  likeCount: r.like_count,
  repostCount: r.repost_count,
  replyCount: r.reply_count,
  quoteCount: r.quote_count,
  createdAt: new Date(r.created_at),
  deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
  author: { id: r.author_id, handle: r.author_handle, displayName: r.author_display_name, verified: r.author_verified },
  replyToHandle: r.reply_to_handle,
});

const toListRow = (r: RawListRow): ListRow => ({ postId: r.post_id, sortAt: new Date(r.sort_at), reposterId: r.reposter_id });

const toProfileListRow = (r: RawProfileListRow): ProfileListRow => ({ profileId: r.profile_id, sortAt: new Date(r.sort_at) });

const toProfile = (r: RawProfile): ProfileRow => ({
  id: r.id,
  handle: r.handle,
  displayName: r.display_name,
  bio: r.bio,
  verified: r.verified,
  followerCount: r.follower_count,
  followingCount: r.following_count,
  postCount: r.post_count,
  createdAt: new Date(r.created_at),
});

/** `p` is the posts alias in every read below. */
const visibleTo = (viewer: string | null): SQL =>
  viewer === null
    ? sql`p.state = 'visible'`
    : sql`(p.state = 'visible' or (p.author_id = ${viewer}::uuid and p.state in ('withheld', 'removed')))`;

/** No block in either direction between the viewer and the author of `p`. */
const authorNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = p.author_id) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = p.author_id))`;

/** No block in either direction with the author or the reposter of a timeline item `i`. */
const itemNotBlocked = (viewer: string | null): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id in (i.author_id, i.reposter_id)) or (b.blocked_id = ${viewer}::uuid and b.blocker_id in (i.author_id, i.reposter_id)))`;

const itemNotMuted = (viewer: string | null): SQL =>
  viewer === null ? sql`true` : sql`not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id in (i.author_id, i.reposter_id))`;

/** Raw queries take timestamps as ISO text, never as Date objects. */
const at = (cursor: Cursor): string => new Date(cursor.t).toISOString();

const before = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const after = (cursor: Cursor | undefined, sortAt: SQL, id: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}) > (${at(cursor)}::timestamptz, ${cursor.id}::uuid)` : sql`true`;

const beforeItem = (cursor: Cursor | undefined): SQL =>
  cursor
    ? sql`(i.sort_at, i.post_id, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid)) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)`
    : sql`true`;

const POST_COLUMNS = sql`p.id, p.author_id, p.body, p.reply_to_id, p.quote_of_id, p.state, p.like_count, p.repost_count, p.reply_count, p.quote_count,
  ${iso("p.created_at")} as created_at, ${iso("p.deleted_at")} as deleted_at,
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified, rp.handle as reply_to_handle`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at from profiles`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /** `within` runs in the same transaction once the post exists, which is how its images are attached. */
    async createPost(input: { authorId: string; body: string; replyToId: string | null; quoteOfId: string | null; now: Date; within?: (tx: DbTx, postId: string) => Promise<void> }): Promise<string> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(posts)
          .values({ authorId: input.authorId, body: input.body, replyToId: input.replyToId, quoteOfId: input.quoteOfId, createdAt: input.now })
          .returning({ id: posts.id });
        if (input.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, 1) }).where(eq(posts.id, input.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, 1) }).where(eq(profiles.id, input.authorId));
        }
        if (input.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, 1) }).where(eq(posts.id, input.quoteOfId));
        await input.within?.(tx, row!.id);
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. `within` runs in the same transaction. */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author")))
          .returning({ replyToId: posts.replyToId, quoteOfId: posts.quoteOfId });
        if (!old) return false;
        if (old.replyToId) {
          await tx.update(posts).set({ replyCount: bump(posts.replyCount, -1) }).where(eq(posts.id, old.replyToId));
        } else {
          await tx.update(profiles).set({ postCount: bump(profiles.postCount, -1) }).where(eq(profiles.id, authorId));
        }
        if (old.quoteOfId) await tx.update(posts).set({ quoteCount: bump(posts.quoteCount, -1) }).where(eq(posts.id, old.quoteOfId));
        await within?.(tx);
        return true;
      });
    },

    /** Posts by id with their author and the handle they reply to, in no particular order. Includes deleted and hidden posts; callers apply visibility. */
    async findPosts(ids: string[]): Promise<Map<string, PostRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawPost>(sql`select ${POST_COLUMNS} ${POST_JOINS} where p.id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toPost(r)]));
    },

    /** Ids of the reply chain above a post, root first, at most MAX_ANCESTORS long. */
    async ancestorIds(postId: string): Promise<string[]> {
      const raw = await rows<{ id: string }>(sql`
        with recursive chain as (
          select p.id, p.reply_to_id, 1 as depth from posts p where p.id = (select reply_to_id from posts where id = ${postId}::uuid)
          union all
          select p.id, p.reply_to_id, c.depth + 1 from posts p join chain c on p.id = c.reply_to_id where c.depth < ${MAX_ANCESTORS}
        )
        select id from chain order by depth desc`);
      return raw.map((r) => r.id);
    },

    /** Direct replies visible to the viewer, oldest first. */
    async replies(postId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.reply_to_id = ${postId}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${after(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at asc, p.id asc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ engagement

    async like(userId: string, postId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unlike(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(likes).where(and(eq(likes.userId, userId), eq(likes.postId, postId))).returning({ postId: likes.postId });
        if (deleted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async repost(userId: string, postId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        return inserted.length > 0;
      });
    },
    async unrepost(userId: string, postId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(reposts).where(and(eq(reposts.userId, userId), eq(reposts.postId, postId))).returning({ postId: reposts.postId });
        if (deleted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, -1) }).where(eq(posts.id, postId));
        return deleted.length > 0;
      });
    },
    async bookmark(userId: string, postId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
      return inserted.length > 0;
    },
    async unbookmark(userId: string, postId: string): Promise<boolean> {
      const deleted = await db.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId))).returning({ postId: bookmarks.postId });
      return deleted.length > 0;
    },

    /** Whether the viewer liked, reposted or bookmarked each post. Missing ids are all false. */
    async viewerPostStates(viewer: string, postIds: string[]): Promise<Map<string, ViewerPostRow>> {
      const states = new Map(postIds.map((id) => [id, { liked: false, reposted: false, bookmarked: false }]));
      if (postIds.length === 0) return states;
      const raw = await rows<{ post_id: string; kind: "l" | "r" | "b" }>(sql`
        select post_id, 'l' as kind from likes where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'r' from reposts where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})
        union all select post_id, 'b' from bookmarks where user_id = ${viewer}::uuid and post_id = any(${uuidArray(postIds)})`);
      for (const r of raw) {
        const state = states.get(r.post_id)!;
        if (r.kind === "l") state.liked = true;
        else if (r.kind === "r") state.reposted = true;
        else state.bookmarked = true;
      }
      return states;
    },

    // ------------------------------------------------------------ graph

    async follow(followerId: string, followeeId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        return inserted.length > 0;
      });
    },
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => removeFollow(tx, followerId, followeeId));
    },

    /** Blocks and, in the same transaction, removes follows in both directions. False when the block already existed. */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      const inserted = await db.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
      return inserted.length > 0;
    },
    async unmute(muterId: string, mutedId: string): Promise<boolean> {
      const deleted = await db.delete(mutes).where(and(eq(mutes.fromId, muterId), eq(mutes.toId, mutedId))).returning({ toId: mutes.toId });
      return deleted.length > 0;
    },

    async relation(viewer: string, other: string): Promise<Relation> {
      const [r] = await rows<Relation>(sql`select
        exists(select 1 from follows where follower_id = ${viewer}::uuid and followee_id = ${other}::uuid) as "following",
        exists(select 1 from follows where follower_id = ${other}::uuid and followee_id = ${viewer}::uuid) as "followedBy",
        exists(select 1 from blocks where blocker_id = ${viewer}::uuid and blocked_id = ${other}::uuid) as "blocked",
        exists(select 1 from blocks where blocker_id = ${other}::uuid and blocked_id = ${viewer}::uuid) as "blockedBy",
        exists(select 1 from mutes where muter_id = ${viewer}::uuid and muted_id = ${other}::uuid) as "muted"`);
      return r!;
    },

    /** Of the given accounts, those with a block in either direction with the viewer. */
    async blockedEitherWay(viewer: string, otherIds: string[]): Promise<Set<string>> {
      if (otherIds.length === 0) return new Set();
      const raw = await rows<{ other: string }>(sql`
        select blocked_id as other from blocks where blocker_id = ${viewer}::uuid and blocked_id = any(${uuidArray(otherIds)})
        union select blocker_id from blocks where blocked_id = ${viewer}::uuid and blocker_id = any(${uuidArray(otherIds)})`);
      return new Set(raw.map((r) => r.other));
    },

    followers(profileId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
        order by f.created_at desc, f.followee_id desc limit ${limit}`);
    },
    blockedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select b.blocked_id as profile_id, ${iso("b.created_at")} as sort_at from blocks b
        where b.blocker_id = ${userId}::uuid and ${before(cursor, sql`b.created_at`, sql`b.blocked_id`)}
        order by b.created_at desc, b.blocked_id desc limit ${limit}`);
    },
    mutedList(userId: string, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select m.muted_id as profile_id, ${iso("m.created_at")} as sort_at from mutes m
        where m.muter_id = ${userId}::uuid and ${before(cursor, sql`m.created_at`, sql`m.muted_id`)}
        order by m.created_at desc, m.muted_id desc limit ${limit}`);
    },
    /** Of the given accounts, those the viewer follows. */
    async followedBy(viewer: string, ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const raw = await rows<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer}::uuid and followee_id = any(${uuidArray(ids)})`);
      return new Set(raw.map((r) => r.id));
    },

    // ------------------------------------------------------------ timelines and lists

    /** Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes apply to author and reposter. */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** Every visible top-level post and quote, newest first; a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** The viewer's likes, newest like first; posts they may no longer see are omitted. */
    async likedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("l.created_at")} as sort_at, null::uuid as reposter_id from likes l join posts p on p.id = l.post_id
        where l.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`l.created_at`, sql`p.id`)}
        order by l.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },
    async bookmarkedPosts(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("b.created_at")} as sort_at, null::uuid as reposter_id from bookmarks b join posts p on p.id = b.post_id
        where b.user_id = ${viewer}::uuid and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)} and ${before(cursor, sql`b.created_at`, sql`p.id`)}
        order by b.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    // ------------------------------------------------------------ profiles

    async findProfileByHandle(handle: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where lower(handle) = ${handle.toLowerCase()} and deleted_at is null`);
      return r ? toProfile(r) : null;
    },
    async findProfiles(ids: string[]): Promise<Map<string, ProfileRow>> {
      if (ids.length === 0) return new Map();
      const raw = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = any(${uuidArray(ids)})`);
      return new Map(raw.map((r) => [r.id, toProfile(r)]));
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
```

### Replace `apps/api/src/social/views.ts` (whole file)

```ts
import type { Author, PostView, TimelineItem, Tombstone } from "@korbat/contracts";
import type { SocialDeps, ViewerId } from "./context";
import { encodeCursor } from "./cursor";
import type { ListRow, PostRow, ProfileRow } from "./repo";
import { postAccess, tombstone } from "./visibility";

/** Where views come from: the posts, and their images through the media module. */
export type ViewSource = Pick<SocialDeps, "repo" | "media">;

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
 * the viewer's like, repost and bookmark state, and every post's images. Ids that resolve to nothing
 * become tombstones, and tombstones carry no images.
 */
export async function loadPostViews({ repo, media }: ViewSource, viewer: ViewerId, ids: string[]): Promise<Map<string, LoadedPost>> {
  const unique = [...new Set(ids)];
  const primary = await repo.findPosts(unique);
  const quoteIds = [...new Set([...primary.values()].map((row) => row.quoteOfId).filter((id): id is string => id !== null && !primary.has(id)))];
  const quoted = await repo.findPosts(quoteIds);
  const all = new Map([...primary, ...quoted]);
  const authorIds = [...new Set([...all.values()].map((row) => row.authorId))];
  const blocked = viewer ? await repo.blockedEitherWay(viewer, authorIds) : new Set<string>();
  const states = viewer ? await repo.viewerPostStates(viewer, [...all.keys()]) : null;
  const images = await media.forPosts([...all.keys()]);

  const access = (row: PostRow) => postAccess(viewer, row, blocked.has(row.authorId));
  const base = (row: PostRow) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    state: row.state as PostView["state"],
    replyTo: row.replyToId ? { id: row.replyToId, authorHandle: row.replyToHandle ?? "" } : null,
    counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount },
    media: images.get(row.id) ?? [],
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
  const reposters = await source.repo.findProfiles([...new Set(rows.map((row) => row.reposterId).filter((id): id is string => id !== null))]);
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

### Replace `apps/api/src/social/flows/posts.ts` (whole file)

```ts
import type { CreatePostRequest, Pagination, PostView, ThreadResponse } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { PostRow, ProfileRow } from "../repo";
import { isTombstone, loadPostViews, pageCursor, postView, postViews } from "../views";
import { postAccess } from "../visibility";

/** The viewer's own profile row; the tiers need its creation time. */
export async function ownProfile(deps: SocialDeps, viewer: string): Promise<ProfileRow> {
  const profile = (await deps.repo.findProfiles([viewer])).get(viewer);
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/**
 * A post the viewer wants to act on. The refusal is directional: when the viewer blocked the
 * author it is `blocked`; when the author blocked the viewer, or the post is hidden or deleted,
 * it is `hiddenCode`, which reveals nothing.
 */
export async function targetPost(deps: SocialDeps, viewer: string, id: string, hiddenCode: "not_found" | "post_unavailable" = "not_found"): Promise<PostRow> {
  const hidden = () => new SocialError(hiddenCode, hiddenCode === "not_found" ? 404 : 400);
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw hidden();
  if (row.authorId !== viewer) {
    const relation = await deps.repo.relation(viewer, row.authorId);
    if (relation.blocked) throw new SocialError("blocked", 403);
    if (relation.blockedBy) throw hidden();
  }
  if (postAccess(viewer, row, false) !== "shown") throw hidden();
  return row;
}

export async function createPost(deps: SocialDeps, viewer: string, input: CreatePostRequest): Promise<PostView> {
  const me = await ownProfile(deps, viewer);
  const action = input.replyToId ? "reply" : input.quoteOfId ? "quote" : "post";
  const targetId = input.replyToId ?? input.quoteOfId;
  if (targetId) await targetPost(deps, viewer, targetId, "post_unavailable");
  await enforceWriteLimit(deps.limits, viewer, action, me.createdAt, deps.now());
  const id = await deps.repo.createPost({
    authorId: viewer,
    body: input.body,
    replyToId: input.replyToId ?? null,
    quoteOfId: input.quoteOfId ?? null,
    now: deps.now(),
    within: (tx, postId) => deps.media.attach(tx, { postId, ownerId: viewer, items: input.media }),
  });
  return (await postView(deps, viewer, id))!;
}

export async function getPost(deps: SocialDeps, viewer: ViewerId, id: string): Promise<PostView> {
  const view = await postView(deps, viewer, id);
  if (!view) throw new SocialError("not_found", 404);
  return view;
}

/** Author only. Deleting twice is a no-op. Someone who may not see the post learns nothing. */
export async function deletePost(deps: SocialDeps, viewer: string, id: string): Promise<void> {
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw new SocialError("not_found", 404);
  if (row.authorId === viewer) {
    // The image rows go with the post, in its transaction. Their files are deleted after the commit: files cannot be rolled back.
    let images: string[] = [];
    await deps.repo.deletePost(id, viewer, deps.now(), async (tx) => {
      images = await deps.media.detachAll(tx, id);
    });
    await deps.media.requestDeletion(images);
    return;
  }
  const blocked = (await deps.repo.blockedEitherWay(viewer, [row.authorId])).has(row.authorId);
  if (postAccess(viewer, row, blocked) !== "shown") throw new SocialError("not_found", 404);
  throw new SocialError("not_author", 403);
}

/** The post, its ancestors root first (tombstones where needed), and a page of direct replies oldest first. */
export async function thread(deps: SocialDeps, viewer: ViewerId, id: string, query: Pagination): Promise<ThreadResponse> {
  const post = await getPost(deps, viewer, id);
  const ancestorIds = await deps.repo.ancestorIds(id);
  const loaded = await loadPostViews(deps, viewer, ancestorIds);
  const ancestors = ancestorIds.map((ancestorId) => loaded.get(ancestorId)!);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await deps.repo.replies(id, viewer, cursor, query.limit);
  const items = await postViews(deps, viewer, rows);
  return { ancestors: ancestors.map((a) => (isTombstone(a) ? a : a)), post, replies: { items, nextCursor: pageCursor(rows, query.limit) } };
}
```

### Replace `apps/api/src/social/flows/timelines.ts` (whole file)

```ts
import type { Pagination, PostPage, TimelinePage } from "@korbat/contracts";
import type { SocialDeps, ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import { pageCursor, postViews, timelineItems } from "../views";
import { visibleProfile } from "./profiles";

const cursorOf = (query: Pagination) => (query.cursor ? decodeCursor(query.cursor) : undefined);

/** Top-level posts, quotes and reposts from followed accounts and the viewer, newest first. */
export async function followingTimeline(deps: SocialDeps, viewer: string, query: Pagination): Promise<TimelinePage> {
  const rows = await deps.repo.followingTimeline(viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** Every visible top-level post and quote, newest first. Public; a signed-in viewer's blocks and mutes apply. */
export async function latestTimeline(deps: SocialDeps, viewer: ViewerId, query: Pagination): Promise<TimelinePage> {
  const rows = await deps.repo.latestTimeline(viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Posts tab: its top-level posts, quotes and reposts. */
export async function profilePosts(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<TimelinePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profilePosts(target.id, viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Replies tab, newest first. */
export async function profileReplies(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<PostPage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profileReplies(target.id, viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own likes, newest like first. */
export async function likedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.likedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own bookmarks, newest bookmark first. */
export async function bookmarkedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.bookmarkedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
```

### Replace `apps/api/src/index.ts` (whole file)

```ts
import { serve } from "@hono/node-server";
import Redis from "ioredis";
import { closeDb, createDb, ping } from "@korbat/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";
import { smtpMailer } from "./mail/smtp";
import { createMedia } from "./media";
import { RedisStore } from "./middleware/rate-limit";
import { createProfileStore } from "./profiles/store";
import { createSocial, enforceWriteLimit } from "./social";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const apiDb = createDb(config.DATABASE_URL_API);
const authDb = createDb(config.DATABASE_URL_AUTH, { max: 4 });
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => logger.error({ err }, "redis error"));
const rateLimitStore = new RedisStore(redis);

const auth = createAuth({
  config,
  logger,
  authDb,
  redis,
  mailer: smtpMailer(config.SMTP_URL, config.MAIL_FROM),
  profiles: createProfileStore(apiDb),
});

const media = createMedia({
  apiDb,
  uploadsDir: config.MEDIA_UPLOADS_DIR,
  storeDir: config.MEDIA_STORE_DIR,
  formats: config.MEDIA_FORMATS,
  minFreeBytes: config.MEDIA_MIN_FREE_BYTES,
  logger,
  requireSession: auth.requireSession,
  resolveSession: auth.resolveSession,
  rateLimitStore,
  enforceUploadLimit: (userId, accountCreatedAt, now) => enforceWriteLimit(rateLimitStore, userId, "upload", accountCreatedAt, now),
});
await media.prepare();

const social = createSocial({ apiDb, rateLimitStore, logger, requireSession: auth.requireSession, media: media.forPosts });

const app = createApp({
  config,
  logger,
  rateLimitStore,
  healthChecks: {
    postgres_api: () => ping(apiDb),
    postgres_auth: () => ping(authDb),
    redis: async () => { await redis.ping(); },
  },
  advisoryChecks: { image_worker: media.healthCheck },
  auth,
  social,
  media,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: "0.0.0.0" }, (info) => {
  logger.info({ port: info.port, version: config.KORBAT_VERSION }, "api listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await Promise.allSettled([closeDb(apiDb), closeDb(authDb), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
```

### Replace `apps/api/src/social/routes.ts` (whole file)

```ts
import { CreatePostRequest, HandleParam, Pagination, PostId } from "@korbat/contracts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { errorBody } from "../lib/errors";
import { validate } from "../lib/validate";
import { MediaError } from "../media";
import { SocialError, type SocialDeps, type ViewerId } from "./context";
import { setEngagement, type EngagementKind } from "./flows/engagement";
import { blockedList, mutedList, setBlock, setFollow, setMute } from "./flows/graph";
import { createPost, deletePost, getPost, thread } from "./flows/posts";
import { followers, following, profile } from "./flows/profiles";
import { bookmarkedPosts, followingTimeline, latestTimeline, likedPosts, profilePosts, profileReplies } from "./flows/timelines";

const PostParam = z.object({ id: PostId });
const ProfileParam = z.object({ handle: HandleParam });

/**
 * Every social endpoint, mounted at `/api`. Handlers only validate, call a flow and shape the
 * response. `guard` is the auth module's requireSession: an onboarded account, with CSRF and
 * Origin already checked for cookie sessions.
 */
export function socialRoutes(deps: SocialDeps, guard: MiddlewareHandler<AppEnv>) {
  const r = new Hono<AppEnv>();
  const viewer = (c: Context<AppEnv>): ViewerId => c.get("session")?.userId ?? null;
  const me = (c: Context<AppEnv>): string => c.get("session")!.userId;

  r.onError((err, c) => {
    if (err instanceof SocialError) {
      if (err.retryAfterSeconds) c.header("Retry-After", String(err.retryAfterSeconds));
      return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    }
    // Creating a post attaches its images through the media module, which refuses with its own error type.
    if (err instanceof MediaError) return c.json(errorBody(err.code, err.message, c.get("requestId")), err.status);
    c.get("log").error({ err }, "unhandled error in social route");
    return c.json(errorBody("internal", "Internal error", c.get("requestId")), 500);
  });

  // ---------------------------------------------------------------- posts

  r.post("/posts", guard, validate("json", CreatePostRequest), async (c) => c.json(await createPost(deps, me(c), c.req.valid("json")), 201));
  r.get("/posts/:id", validate("param", PostParam), async (c) => c.json(await getPost(deps, viewer(c), c.req.valid("param").id)));
  r.delete("/posts/:id", guard, validate("param", PostParam), async (c) => {
    await deletePost(deps, me(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  r.get("/posts/:id/thread", validate("param", PostParam), validate("query", Pagination), async (c) =>
    c.json(await thread(deps, viewer(c), c.req.valid("param").id, c.req.valid("query"))),
  );

  for (const kind of ["like", "repost", "bookmark"] as EngagementKind[]) {
    r.post(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, true)));
    r.delete(`/posts/:id/${kind}`, guard, validate("param", PostParam), async (c) => c.json(await setEngagement(deps, me(c), c.req.valid("param").id, kind, false)));
  }

  // ---------------------------------------------------------------- timelines

  r.get("/timeline/following", guard, validate("query", Pagination), async (c) => c.json(await followingTimeline(deps, me(c), c.req.valid("query"))));
  r.get("/timeline/latest", validate("query", Pagination), async (c) => c.json(await latestTimeline(deps, viewer(c), c.req.valid("query"))));

  // ---------------------------------------------------------------- profiles and graph

  r.get("/profiles/:handle", validate("param", ProfileParam), async (c) => c.json(await profile(deps, viewer(c), c.req.valid("param").handle)));
  r.get("/profiles/:handle/posts", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profilePosts(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/replies", validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await profileReplies(deps, viewer(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/followers", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await followers(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );
  r.get("/profiles/:handle/following", guard, validate("param", ProfileParam), validate("query", Pagination), async (c) =>
    c.json(await following(deps, me(c), c.req.valid("param").handle, c.req.valid("query"))),
  );

  r.post("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/follow", guard, validate("param", ProfileParam), async (c) => c.json(await setFollow(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/block", guard, validate("param", ProfileParam), async (c) => c.json(await setBlock(deps, me(c), c.req.valid("param").handle, false)));
  r.post("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, true)));
  r.delete("/profiles/:handle/mute", guard, validate("param", ProfileParam), async (c) => c.json(await setMute(deps, me(c), c.req.valid("param").handle, false)));

  // ---------------------------------------------------------------- the viewer's private lists

  r.get("/me/likes", guard, validate("query", Pagination), async (c) => c.json(await likedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/bookmarks", guard, validate("query", Pagination), async (c) => c.json(await bookmarkedPosts(deps, me(c), c.req.valid("query"))));
  r.get("/me/blocks", guard, validate("query", Pagination), async (c) => c.json(await blockedList(deps, me(c), c.req.valid("query"))));
  r.get("/me/mutes", guard, validate("query", Pagination), async (c) => c.json(await mutedList(deps, me(c), c.req.valid("query"))));

  return r;
}
```

## Step 4: verify: contracts

```bash
pnpm --filter @korbat/contracts test
```

Expected output contains:

- `Tests  44 passed (44)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  44 passed (44)
```

## Step 5: verify: typecheck

```bash
pnpm typecheck
```

Expected: the command succeeds.

Must not contain:

- `error TS`

Observed on the dry run:

```text
(no output)
```

## Step 6: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  142 passed | 125 skipped (267)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  142 passed | 125 skipped (267)
```

## Step 7: verify: integration

```bash
pnpm --filter @korbat/api test:integration
```

Expected output contains:

- `Tests  124 passed (124)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  124 passed (124)
```

## Step 8: verify: build

```bash
pnpm --filter @korbat/api build
```

Expected output contains:

- `Build success`

Must not contain:

- `error`

Observed on the dry run:

```text
ESM ⚡️ Build success in 448ms
```

## Step 9: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/index.ts`
- `apps/api/src/media/context.ts`
- `apps/api/src/media/index.ts`
- `apps/api/src/media/repo.ts`
- `apps/api/src/social/context.ts`
- `apps/api/src/social/flows/posts.ts`
- `apps/api/src/social/flows/timelines.ts`
- `apps/api/src/social/index.ts`
- `apps/api/src/social/repo.ts`
- `apps/api/src/social/routes.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/integration/social-flows-graph.test.ts`
- `apps/api/test/integration/social-flows-posts.test.ts`
- `apps/api/test/integration/social-harness.ts`
- `apps/api/test/integration/social-media.test.ts`
- `packages/contracts/src/social.ts`
- `packages/contracts/test/social.test.ts`
- `packages/db/src/index.ts`

## Step 10: commit

```bash
git add -A
git commit -q -m "feat(social): posts, replies and quotes carry up to four described images, attached and detached inside the post's transaction; every view has its media" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): posts, replies and quotes carry up to four described images, attached and detached inside the post's transaction; every view has its media`.

## Report format (mandatory)

```text
TASK 11 REPORT
Files written: <count, expected 18>
Failing-test step (the error line): <paste>
Verify "contracts": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "test": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Verify "build": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
