# korbat 2a — Task 5 of 13: Post views, and the post and engagement flows

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Post views are built once, for one viewer: rows and, one level deep, the posts they quote; access decided per row with the visibility rule and the viewer's blocks; the viewer's like, repost and bookmark state attached. On that sit the post flows (create with directional block errors and tiered limits, get, delete that blanks the body, thread with ancestors and paged replies) and the engagement flows, which are idempotent and only limit the action, never its undo.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): repository with transactional counters, keyset timelines, block and mute filtering, thread and list queries`.
3. The previous task's last API unit run ended with `Tests  102 passed | 76 skipped (178)`.

## Rules (read twice)

1. Copy every file below byte for byte. Each block is the complete file: create it, or replace the existing file entirely. Paths with parentheses or square brackets (expo-router routes) are literal; quote them in shell commands.
2. Run every command exactly as written, in order, from the repo root, without adding filters such as `tail` or `head`.
3. After each command, check that every **Expected** line appears in the output and no **Must not contain** text does. A missing line, a forbidden text, a different test count, or an unexpected `error TS`, `ERR_PNPM` or `FAIL` line is a **STOP condition**, unless the step names it as an allowed difference.
4. On a STOP condition: do not change the given code and do not try alternatives. If rule 5 applies, do that once; otherwise stop, write the report with the exact output, and end the session.
5. Permitted recovery, only for an error containing `Cannot find module` in a verification step (never in the failing-test step, where it is expected): run `rm -rf node_modules && pnpm install --frozen-lockfile` once from the repo root and repeat the failed command. Record it.
6. `.env` files are gitignored and hold real secrets. Never print them, never commit them, never paste their values into the report.
7. Commit exactly once, at the end, with the exact message given.
8. The report format at the bottom is mandatory.

## Step 1: write the tests

### Create `apps/api/test/integration/social-harness.ts`

```ts
import pino from "pino";
import type { Db } from "@korbat/db";
import { MemoryStore } from "../../src/middleware/rate-limit";
import type { SocialDeps } from "../../src/social/context";
import { createSocialRepo } from "../../src/social/repo";
import { DAY_MS, HOUR_MS } from "../../src/social/tiers";
import { newProfile, ticker } from "./social-fixtures";

/**
 * Real repository on Postgres, in-memory limits, and a clock the test moves. Every read of the
 * clock by a flow advances it one millisecond, so consecutive actions never share a timestamp and
 * list order in the tests is never left to the tie-breaker.
 */
export function socialHarness(db: Db) {
  const clock = ticker();
  const repo = createSocialRepo(db);
  const deps: SocialDeps = { repo, limits: new MemoryStore(() => clock.now().getTime()), log: pino({ level: "silent" }), now: clock.next };
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

### Create `apps/api/test/integration/social-flows-posts.test.ts`

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
    return createPost(h.deps, viewer, { body, ...extra });
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

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/social/flows/`

Observed on the dry run:

```text
Error: Cannot find module '../../src/social/flows/engagement' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/social-flows-posts.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/social/views.ts`

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

### Create `apps/api/src/social/flows/posts.ts`

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
  });
  return (await postView(deps.repo, viewer, id))!;
}

export async function getPost(deps: SocialDeps, viewer: ViewerId, id: string): Promise<PostView> {
  const view = await postView(deps.repo, viewer, id);
  if (!view) throw new SocialError("not_found", 404);
  return view;
}

/** Author only. Deleting twice is a no-op. Someone who may not see the post learns nothing. */
export async function deletePost(deps: SocialDeps, viewer: string, id: string): Promise<void> {
  const row = (await deps.repo.findPosts([id])).get(id);
  if (!row) throw new SocialError("not_found", 404);
  if (row.authorId === viewer) {
    await deps.repo.deletePost(id, viewer, deps.now());
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
  const loaded = await loadPostViews(deps.repo, viewer, ancestorIds);
  const ancestors = ancestorIds.map((ancestorId) => loaded.get(ancestorId)!);
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
  const rows = await deps.repo.replies(id, viewer, cursor, query.limit);
  const items = await postViews(deps.repo, viewer, rows);
  return { ancestors: ancestors.map((a) => (isTombstone(a) ? a : a)), post, replies: { items, nextCursor: pageCursor(rows, query.limit) } };
}
```

### Create `apps/api/src/social/flows/engagement.ts`

```ts
import type { EngagementResponse } from "@korbat/contracts";
import type { SocialDeps } from "../context";
import { enforceWriteLimit } from "../limits";
import { ownProfile, targetPost } from "./posts";

export type EngagementKind = "like" | "repost" | "bookmark";

/**
 * Likes, reposts and bookmarks and their undos. Doing an action twice, or undoing one that was not
 * done, changes nothing and returns the current state. Only the action itself is rate limited.
 */
export async function setEngagement(deps: SocialDeps, viewer: string, postId: string, kind: EngagementKind, on: boolean): Promise<EngagementResponse> {
  await targetPost(deps, viewer, postId);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, kind, me.createdAt, deps.now());
    if (kind === "like") await deps.repo.like(viewer, postId, deps.now());
    else if (kind === "repost") await deps.repo.repost(viewer, postId, deps.now());
    else await deps.repo.bookmark(viewer, postId, deps.now());
  } else if (kind === "like") await deps.repo.unlike(viewer, postId);
  else if (kind === "repost") await deps.repo.unrepost(viewer, postId);
  else await deps.repo.unbookmark(viewer, postId);

  const row = (await deps.repo.findPosts([postId])).get(postId)!;
  const state = (await deps.repo.viewerPostStates(viewer, [postId])).get(postId)!;
  return { counts: { likes: row.likeCount, reposts: row.repostCount, replies: row.replyCount, quotes: row.quoteCount }, viewer: state };
}
```

### Replace `apps/api/src/social/context.ts` (whole file)

```ts
import type { SocialErrorCode } from "@korbat/contracts";
import type { Logger } from "pino";
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

export interface SocialDeps {
  repo: SocialRepo;
  /** Per-account write limits; the same store the per-IP middleware uses. */
  limits: RateLimitStore;
  log: Logger;
  now: () => Date;
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  102 passed | 82 skipped (184)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  102 passed | 82 skipped (184)
```

## Step 5: verify: typecheck

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

## Step 6: verify: integration

```bash
cd apps/api && set -a && . ./.env && set +a && pnpm test:integration
```

Expected output contains:

- `Tests  82 passed (82)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  82 passed (82)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/context.ts`
- `apps/api/src/social/flows/engagement.ts`
- `apps/api/src/social/flows/posts.ts`
- `apps/api/src/social/views.ts`
- `apps/api/test/integration/social-flows-posts.test.ts`
- `apps/api/test/integration/social-harness.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(social): post view hydration with one-level quotes and tombstones; create, get, delete, thread; like, repost, bookmark" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): post view hydration with one-level quotes and tombstones; create, get, delete, thread; like, repost, bookmark`.

## Report format (mandatory)

```text
TASK 5 REPORT
Files written: <count, expected 6>
Failing-test step (the error line): <paste>
Verify "test": <paste the expected lines as printed>
Verify "typecheck": <paste the expected lines as printed>
Verify "integration": <paste the expected lines as printed>
Change set: <paste git status output>
Commit: <paste git log --oneline -1>
Recovery used (rule 5): yes/no
Allowed differences used: none | <which>
STOP condition hit: none | <exact output>
```
