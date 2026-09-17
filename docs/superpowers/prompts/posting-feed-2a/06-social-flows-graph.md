# korbat 2a — Task 6 of 13: Graph, profile and timeline flows

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Follow, block and mute with their undos, the profile view with the viewer's relation, follower and following lists for signed-in viewers, and every timeline and private list. A profile a viewer may not see is not found. Blocking removes follows in both directions inside the repository's transaction. All lists page with the shared cursor.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): post view hydration with one-level quotes and tombstones; create, get, delete, thread; like, repost, bookmark`.
3. The previous task's last API unit run ended with `Tests  102 passed | 82 skipped (184)`.

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

### Create `apps/api/test/integration/social-flows-graph.test.ts`

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
    return createPost(h.deps, viewer, { body, ...extra });
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
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/social/flows/graph'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/social/flows/graph' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/social-flows-graph.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/social/flows/profiles.ts`

```ts
import type { Pagination, ProfileListItem, ProfilePage, ProfileView } from "@korbat/contracts";
import { SocialError, type SocialDeps, type ViewerId } from "../context";
import { decodeCursor } from "../cursor";
import type { ProfileListRow, ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";

/** A profile by handle (a leading @ is tolerated), or not_found. Does not consider the viewer. */
export async function lookupProfile(deps: SocialDeps, handle: string): Promise<ProfileRow> {
  const profile = await deps.repo.findProfileByHandle(handle.replace(/^@/, ""));
  if (!profile) throw new SocialError("not_found", 404);
  return profile;
}

/** A profile the viewer may see: a block in either direction makes it not_found. */
export async function visibleProfile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (viewer && viewer !== profile.id && (await deps.repo.blockedEitherWay(viewer, [profile.id])).size > 0) {
    throw new SocialError("not_found", 404);
  }
  return profile;
}

export async function profile(deps: SocialDeps, viewer: ViewerId, handle: string): Promise<ProfileView> {
  const target = await visibleProfile(deps, viewer, handle);
  const view: ProfileView = {
    id: target.id,
    handle: target.handle,
    displayName: target.displayName,
    bio: target.bio,
    verified: target.verified,
    createdAt: target.createdAt.toISOString(),
    counts: { posts: target.postCount, followers: target.followerCount, following: target.followingCount },
  };
  if (viewer && viewer !== target.id) {
    const relation = await deps.repo.relation(viewer, target.id);
    view.viewer = { following: relation.following, followedBy: relation.followedBy, blocked: relation.blocked, muted: relation.muted };
  }
  return view;
}

/**
 * Turns list rows into profile items for a signed-in viewer, dropping accounts with a block in
 * either direction and marking which ones the viewer follows.
 */
export async function profileItems(deps: SocialDeps, viewer: string, rows: ProfileListRow[]): Promise<ProfileListItem[]> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, blocked, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.blockedEitherWay(viewer, ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (!row || blocked.has(id)) continue;
    items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return items;
}

export async function followers(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.followers(target.id, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

export async function following(deps: SocialDeps, viewer: string, handle: string, query: Pagination): Promise<ProfilePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.following(target.id, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return { items: await profileItems(deps, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
```

### Create `apps/api/src/social/flows/graph.ts`

```ts
import type { BlockResponse, FollowResponse, MuteResponse, Pagination, ProfileListItem, ProfilePage } from "@korbat/contracts";
import { SocialError, type SocialDeps } from "../context";
import { decodeCursor } from "../cursor";
import { enforceWriteLimit } from "../limits";
import type { ProfileRow } from "../repo";
import { authorOf, pageCursor } from "../views";
import { ownProfile } from "./posts";
import { lookupProfile } from "./profiles";

/** The account a graph action targets. Never yourself. */
async function target(deps: SocialDeps, viewer: string, handle: string): Promise<ProfileRow> {
  const profile = await lookupProfile(deps, handle);
  if (profile.id === viewer) throw new SocialError("self_target", 400);
  return profile;
}

/**
 * Follow or unfollow. Following someone you block is `blocked`; someone who blocks you is
 * `not_found`, like every other read or write towards them. Only the follow itself is limited.
 */
export async function setFollow(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<FollowResponse> {
  const profile = await target(deps, viewer, handle);
  const relation = await deps.repo.relation(viewer, profile.id);
  if (relation.blocked) throw new SocialError("blocked", 403);
  if (relation.blockedBy) throw new SocialError("not_found", 404);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "follow", me.createdAt, deps.now());
    await deps.repo.follow(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unfollow(viewer, profile.id);
  }
  const fresh = (await deps.repo.findProfiles([profile.id])).get(profile.id)!;
  return { following: on, followerCount: fresh.followerCount };
}

/** Block or unblock. Blocking removes follows in both directions; unblocking restores nothing. */
export async function setBlock(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<BlockResponse> {
  const profile = await target(deps, viewer, handle);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "block", me.createdAt, deps.now());
    await deps.repo.block(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unblock(viewer, profile.id);
  }
  return { blocked: on };
}

/** Mute or unmute. Silent: the muted account is never told and nothing else changes. */
export async function setMute(deps: SocialDeps, viewer: string, handle: string, on: boolean): Promise<MuteResponse> {
  const profile = await target(deps, viewer, handle);
  if (on) {
    const me = await ownProfile(deps, viewer);
    await enforceWriteLimit(deps.limits, viewer, "mute", me.createdAt, deps.now());
    await deps.repo.mute(viewer, profile.id, deps.now());
  } else {
    await deps.repo.unmute(viewer, profile.id);
  }
  return { muted: on };
}

async function ownList(deps: SocialDeps, viewer: string, rows: { profileId: string; sortAt: Date }[], limit: number): Promise<ProfilePage> {
  const ids = rows.map((row) => row.profileId);
  const [profiles, followed] = await Promise.all([deps.repo.findProfiles(ids), deps.repo.followedBy(viewer, ids)]);
  const items: ProfileListItem[] = [];
  for (const id of ids) {
    const row = profiles.get(id);
    if (row) items.push({ ...authorOf(row), bio: row.bio, viewerFollows: followed.has(id) });
  }
  return { items, nextCursor: pageCursor(rows, limit) };
}

/** The viewer's own blocked accounts, newest block first. This is where unblocking starts. */
export async function blockedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.blockedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}

export async function mutedList(deps: SocialDeps, viewer: string, query: Pagination): Promise<ProfilePage> {
  const rows = await deps.repo.mutedList(viewer, query.cursor ? decodeCursor(query.cursor) : undefined, query.limit);
  return ownList(deps, viewer, rows, query.limit);
}
```

### Create `apps/api/src/social/flows/timelines.ts`

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
  return { items: await timelineItems(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** Every visible top-level post and quote, newest first. Public; a signed-in viewer's blocks and mutes apply. */
export async function latestTimeline(deps: SocialDeps, viewer: ViewerId, query: Pagination): Promise<TimelinePage> {
  const rows = await deps.repo.latestTimeline(viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Posts tab: its top-level posts, quotes and reposts. */
export async function profilePosts(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<TimelinePage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profilePosts(target.id, viewer, cursorOf(query), query.limit);
  return { items: await timelineItems(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** An account's Replies tab, newest first. */
export async function profileReplies(deps: SocialDeps, viewer: ViewerId, handle: string, query: Pagination): Promise<PostPage> {
  const target = await visibleProfile(deps, viewer, handle);
  const rows = await deps.repo.profileReplies(target.id, viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own likes, newest like first. */
export async function likedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.likedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}

/** The viewer's own bookmarks, newest bookmark first. */
export async function bookmarkedPosts(deps: SocialDeps, viewer: string, query: Pagination): Promise<PostPage> {
  const rows = await deps.repo.bookmarkedPosts(viewer, cursorOf(query), query.limit);
  return { items: await postViews(deps.repo, viewer, rows), nextCursor: pageCursor(rows, query.limit) };
}
```

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  102 passed | 88 skipped (190)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  102 passed | 88 skipped (190)
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

- `Tests  88 passed (88)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  88 passed (88)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/flows/graph.ts`
- `apps/api/src/social/flows/profiles.ts`
- `apps/api/src/social/flows/timelines.ts`
- `apps/api/test/integration/social-flows-graph.test.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(social): follow, block and mute flows; profile views and follower lists; Following, Latest, profile, likes and bookmarks pages" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): follow, block and mute flows; profile views and follower lists; Following, Latest, profile, likes and bookmarks pages`.

## Report format (mandatory)

```text
TASK 6 REPORT
Files written: <count, expected 4>
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
