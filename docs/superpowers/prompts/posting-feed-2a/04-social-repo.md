# korbat 2a — Task 4 of 13: Social repository: posts, engagement, graph, timelines, lists and profiles in SQL

You are executing one task of an approved implementation plan. Every file and command below was executed and verified on 2026-09-17 in a scratch clone of this repository, with the exact versions named. Your job is transcription and verification, not design. Do this task completely, verify it, commit it, and report.

## Project context

Every SQL statement of the social module lives in one repository on the korbat_api pool. Counters change by the number of rows an action really inserted or deleted, so repeats never double-count. Every timestamp is passed in from the clock at millisecond precision so cursors round-trip exactly. Timelines are single queries with the visibility rule, blocks and mutes applied in SQL. Reads are raw SQL, which returns timestamps as text and expands arrays into parameter lists, so the repository formats timestamps as ISO text in SQL and sends id lists as one comma-joined parameter.

## Environment

- Repository: `C:\Users\Lenovo\Desktop\cool\korbat`, branch `main`. Run every command from this directory in Git Bash.
- Windows 11. Node v24.12.0, pnpm 10.30.0.
- **Docker Desktop must be running** with the data services up. Start them with `docker compose -f infra/compose.yml -f infra/compose.dev.yml up -d postgres redis mailpit` and wait until `docker compose -f infra/compose.yml -f infra/compose.dev.yml ps` shows them `healthy` or `running`.
- Never touch Docker containers that are not part of the `korbat` compose project (for example `alita-db` or `dazzling_moore`).
- The workspace refuses package versions younger than 7 days. This sub-project adds no dependencies; do not run `pnpm add`, and never edit `pnpm-workspace.yaml` or `.npmrc`.

## Preconditions

1. `git status --porcelain` prints nothing.
2. `git log --oneline -1` shows `feat(social): error type, keyset cursors, age tiers, per-account write limits, post visibility rule`.
3. The previous task's last API unit run ended with `Tests  102 passed | 67 skipped (169)`.

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

### Create `apps/api/test/integration/social-fixtures.ts`

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { profiles, type Db } from "@korbat/db";
import type { SocialRepo } from "../../src/social/repo";

/** A profile row straight in the public schema; social tests never need an auth user behind it. */
export async function newProfile(db: Db, options: { createdAt?: Date; displayName?: string } = {}) {
  const id = randomUUID();
  const handle = `s_${randomBytes(5).toString("hex")}`;
  await db.insert(profiles).values({ id, handle, displayName: options.displayName ?? `Profile ${handle}`, createdAt: options.createdAt ?? new Date() });
  return { id, handle };
}

/** A clock that hands out strictly increasing millisecond timestamps, so every row sorts unambiguously. */
export function ticker(start: number = Date.now() - 60_000) {
  let t = start;
  return {
    next: () => new Date((t += 1)),
    jump: (ms: number) => new Date((t += ms)),
    now: () => new Date(t),
  };
}

export async function newPost(repo: SocialRepo, authorId: string, at: Date, body = "hello", extra: { replyToId?: string; quoteOfId?: string } = {}) {
  return repo.createPost({ authorId, body, replyToId: extra.replyToId ?? null, quoteOfId: extra.quoteOfId ?? null, now: at });
}
```

### Create `apps/api/test/integration/social-repo.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, type Db } from "@korbat/db";
import { loadConfig } from "../../src/config";
import { createSocialRepo, type ListRow, type SocialRepo } from "../../src/social/repo";
import { newPost, newProfile, ticker } from "./social-fixtures";

const ids = (rowsList: ListRow[]) => rowsList.map((r) => r.postId);

describe.skipIf(!process.env.INTEGRATION)("integration: social repository", () => {
  let db: Db;
  let repo: SocialRepo;

  beforeAll(() => {
    db = createDb(loadConfig().DATABASE_URL_API, { max: 4 });
    repo = createSocialRepo(db);
  });
  afterAll(async () => {
    await closeDb(db);
  });

  test("counters stay exact when actions repeat and undo", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    const post = await newPost(repo, ada.id, clock.next());

    expect(await repo.like(bob.id, post, clock.next())).toBe(true);
    expect(await repo.like(bob.id, post, clock.next())).toBe(false);
    expect(await repo.repost(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(true);
    expect(await repo.bookmark(bob.id, post, clock.next())).toBe(false);
    let row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([1, 1]);
    expect(await repo.viewerPostStates(bob.id, [post])).toEqual(new Map([[post, { liked: true, reposted: true, bookmarked: true }]]));

    expect(await repo.unlike(bob.id, post)).toBe(true);
    expect(await repo.unlike(bob.id, post)).toBe(false);
    expect(await repo.unrepost(bob.id, post)).toBe(true);
    expect(await repo.unbookmark(bob.id, post)).toBe(true);
    row = (await repo.findPosts([post])).get(post)!;
    expect([row.likeCount, row.repostCount]).toEqual([0, 0]);
    expect((await repo.viewerPostStates(bob.id, [post])).get(post)).toEqual({ liked: false, reposted: false, bookmarked: false });
  });

  test("replies and quotes count on their target, top-level posts on the author", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: root });
    await newPost(repo, ada.id, clock.next(), "quote", { quoteOfId: root });
    const rootRow = (await repo.findPosts([root])).get(root)!;
    expect([rootRow.replyCount, rootRow.quoteCount]).toEqual([1, 1]);
    expect((await repo.findProfiles([ada.id])).get(ada.id)!.postCount).toBe(2);
    expect((await repo.findPosts([reply])).get(reply)!.replyToHandle).toBe(ada.handle);

    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(true);
    expect(await repo.deletePost(reply, ada.id, clock.next())).toBe(false);
    expect((await repo.findPosts([root])).get(root)!.replyCount).toBe(0);
    const deleted = (await repo.findPosts([reply])).get(reply)!;
    expect(deleted.state).toBe("deleted_by_author");
    expect(deleted.body).toBe("");
    expect(deleted.deletedAt).not.toBeNull();
  });

  test("blocking removes follows in both directions in one transaction and keeps counts exact", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.follow(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.follow(bob.id, ada.id, clock.next())).toBe(true);
    let profilesById = await repo.findProfiles([ada.id, bob.id]);
    expect([profilesById.get(ada.id)!.followerCount, profilesById.get(ada.id)!.followingCount]).toEqual([1, 1]);

    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(true);
    expect(await repo.block(ada.id, bob.id, clock.next())).toBe(false);
    expect(await repo.relation(ada.id, bob.id)).toEqual({ following: false, followedBy: false, blocked: true, blockedBy: false, muted: false });
    expect(await repo.relation(bob.id, ada.id)).toEqual({ following: false, followedBy: false, blocked: false, blockedBy: true, muted: false });
    profilesById = await repo.findProfiles([ada.id, bob.id]);
    for (const p of profilesById.values()) expect([p.followerCount, p.followingCount]).toEqual([0, 0]);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set([ada.id]));
    expect(await repo.unblock(ada.id, bob.id)).toBe(true);
    expect(await repo.blockedEitherWay(bob.id, [ada.id])).toEqual(new Set());
  });

  test("the following timeline pages stably across posts and reposts, and a post reposted twice appears twice", async () => {
    const clock = ticker();
    const [viewer, ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const own = await newPost(repo, viewer.id, clock.next());
    const c1 = await newPost(repo, carol.id, clock.next()); // not followed: appears only through reposts
    await newPost(repo, ada.id, clock.next(), "a reply", { replyToId: a1 });
    await repo.repost(ada.id, c1, clock.next());
    await repo.repost(bob.id, c1, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());

    const all = await repo.followingTimeline(viewer.id, undefined, 10);
    expect(all.map((r) => [r.postId, r.reposterId])).toEqual([
      [b1, null],
      [c1, bob.id],
      [c1, ada.id],
      [own, null],
      [a1, null],
    ]);

    const seen: [string, string | null][] = [];
    let cursor: { t: number; id: string; r?: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const rowsPage = await repo.followingTimeline(viewer.id, cursor, 2);
      if (rowsPage.length === 0) break;
      seen.push(...rowsPage.map((r): [string, string | null] => [r.postId, r.reposterId]));
      const last = rowsPage[rowsPage.length - 1]!;
      cursor = { t: last.sortAt.getTime(), id: last.postId, ...(last.reposterId ? { r: last.reposterId } : {}) };
    }
    expect(seen).toEqual(all.map((r) => [r.postId, r.reposterId]));
  });

  test("blocks hide an author in both directions; mutes hide timelines only", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(viewer.id, ada.id, clock.next());
    await repo.follow(viewer.id, bob.id, clock.next());
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    const reply = await newPost(repo, ada.id, clock.next(), "reply", { replyToId: b1 });

    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);

    await repo.mute(viewer.id, ada.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([reply]);
    expect(ids(await repo.profilePosts(ada.id, viewer.id, undefined, 10))).toEqual([a1]);
    await repo.unmute(viewer.id, ada.id);

    // ada blocks the viewer: the viewer no longer sees ada anywhere, and ada no longer sees the viewer.
    await repo.block(ada.id, viewer.id, clock.next());
    expect(ids(await repo.followingTimeline(viewer.id, undefined, 10))).toEqual([b1]);
    expect(ids(await repo.replies(b1, viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.latestTimeline(viewer.id, undefined, 200))).not.toContain(a1);
    const v1 = await newPost(repo, viewer.id, clock.next());
    expect(ids(await repo.latestTimeline(ada.id, undefined, 200))).not.toContain(v1);
    expect(ids(await repo.latestTimeline(null, undefined, 200))).toEqual(expect.arrayContaining([a1, v1]));
  });

  test("withheld and removed posts appear only to their author; replies never enter timelines", async () => {
    const clock = ticker();
    const [ada, bob] = await Promise.all([newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    const shown = await newPost(repo, ada.id, clock.next());
    const withheld = await newPost(repo, ada.id, clock.next());
    const removed = await newPost(repo, ada.id, clock.next());
    await db.execute(sql`update posts set state = 'withheld' where id = ${withheld}::uuid`);
    await db.execute(sql`update posts set state = 'removed' where id = ${removed}::uuid`);
    await newPost(repo, ada.id, clock.next(), "reply", { replyToId: shown });

    expect(ids(await repo.profilePosts(ada.id, ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.profilePosts(ada.id, bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.profilePosts(ada.id, null, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(bob.id, undefined, 10))).toEqual([shown]);
    expect(ids(await repo.followingTimeline(ada.id, undefined, 10))).toEqual([removed, withheld, shown]);
    expect(ids(await repo.latestTimeline(null, undefined, 500))).not.toContain(withheld);
  });

  test("threads: ancestors come root first and stop at the cap, replies page oldest first", async () => {
    const clock = ticker();
    const ada = await newProfile(db);
    const root = await newPost(repo, ada.id, clock.next(), "root");
    let parent = root;
    const chain = [root];
    for (let depth = 1; depth <= 55; depth++) {
      parent = await newPost(repo, ada.id, clock.next(), `level ${depth}`, { replyToId: parent });
      chain.push(parent);
    }
    const leaf = chain[chain.length - 1]!;
    const ancestors = await repo.ancestorIds(leaf);
    expect(ancestors).toHaveLength(50);
    expect(ancestors).toEqual(chain.slice(-51, -1));
    expect(await repo.ancestorIds(chain[3]!)).toEqual(chain.slice(0, 3));

    const replies = await Promise.all([1, 2, 3].map((n) => newPost(repo, ada.id, clock.next(), `r${n}`, { replyToId: root })));
    const first = await repo.replies(root, null, undefined, 2);
    expect(ids(first)).toEqual([chain[1], replies[0]]);
    const last = first[first.length - 1]!;
    const second = await repo.replies(root, null, { t: last.sortAt.getTime(), id: last.postId }, 2);
    expect(ids(second)).toEqual([replies[1], replies[2]]);
  });

  test("likes and bookmarks list newest first and drop posts the viewer may no longer see", async () => {
    const clock = ticker();
    const [viewer, ada, bob] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    const a1 = await newPost(repo, ada.id, clock.next());
    const b1 = await newPost(repo, bob.id, clock.next());
    await repo.like(viewer.id, a1, clock.next());
    await repo.like(viewer.id, b1, clock.next());
    await repo.bookmark(viewer.id, a1, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([b1, a1]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.block(bob.id, viewer.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([a1]);
    await repo.deletePost(a1, ada.id, clock.next());
    expect(ids(await repo.likedPosts(viewer.id, undefined, 10))).toEqual([]);
    expect(ids(await repo.bookmarkedPosts(viewer.id, undefined, 10))).toEqual([]);
  });

  test("follower and blocked lists page newest first, and profile lookups are case-insensitive", async () => {
    const clock = ticker();
    const [ada, bob, carol] = await Promise.all([newProfile(db), newProfile(db), newProfile(db)]);
    await repo.follow(bob.id, ada.id, clock.next());
    await repo.follow(carol.id, ada.id, clock.next());
    const firstPage = await repo.followers(ada.id, undefined, 1);
    expect(firstPage.map((r) => r.profileId)).toEqual([carol.id]);
    const secondPage = await repo.followers(ada.id, { t: firstPage[0]!.sortAt.getTime(), id: firstPage[0]!.profileId }, 1);
    expect(secondPage.map((r) => r.profileId)).toEqual([bob.id]);
    expect((await repo.following(bob.id, undefined, 10)).map((r) => r.profileId)).toEqual([ada.id]);
    expect(await repo.followedBy(bob.id, [ada.id, carol.id])).toEqual(new Set([ada.id]));

    await repo.block(ada.id, carol.id, clock.next());
    await repo.mute(ada.id, bob.id, clock.next());
    expect((await repo.blockedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([carol.id]);
    expect((await repo.mutedList(ada.id, undefined, 10)).map((r) => r.profileId)).toEqual([bob.id]);

    const found = await repo.findProfileByHandle(ada.handle.toUpperCase());
    expect(found?.id).toBe(ada.id);
    expect([found?.followerCount, found?.followingCount, found?.postCount]).toEqual([1, 0, 0]);
    expect(await repo.findProfileByHandle("no_such_handle_here")).toBeNull();
  });
});
```

## Step 2: run the tests and watch them fail

```bash
pnpm --filter @korbat/api test
```

Expected: the command exits with an error, and the output contains:

- `Cannot find module '../../src/social/repo'`

Observed on the dry run:

```text
Error: Cannot find module '../../src/social/repo' imported from C:\Users\Lenovo\Desktop\cool\korbat/apps/api/test/integration/social-repo.test.ts
```

## Step 3: write the implementation

### Create `apps/api/src/social/repo.ts`

```ts
import { and, eq, ne, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, bookmarks, follows, likes, mutes, posts, profiles, reposts, type Db } from "@korbat/db";
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

    async createPost(input: { authorId: string; body: string; replyToId: string | null; quoteOfId: string | null; now: Date }): Promise<string> {
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
        return row!.id;
      });
    },

    /** Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to delete. */
    async deletePost(id: string, authorId: string, now: Date): Promise<boolean> {
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

## Step 4: verify: test

```bash
pnpm --filter @korbat/api test
```

Expected output contains:

- `Tests  102 passed | 76 skipped (178)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  102 passed | 76 skipped (178)
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

- `Tests  76 passed (76)`

Must not contain:

- `failed`

Observed on the dry run:

```text
Tests  76 passed (76)
```

## Step 7: check the change set

```bash
git status --porcelain --untracked-files=all
```

Expected: exactly these paths, and nothing else (no `.env` file, no `dist/`):

- `apps/api/src/social/repo.ts`
- `apps/api/test/integration/social-fixtures.ts`
- `apps/api/test/integration/social-repo.test.ts`

## Step 8: commit

```bash
git add -A
git commit -q -m "feat(social): repository with transactional counters, keyset timelines, block and mute filtering, thread and list queries" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline -1
```

Expected: one line ending in `feat(social): repository with transactional counters, keyset timelines, block and mute filtering, thread and list queries`.

## Report format (mandatory)

```text
TASK 4 REPORT
Files written: <count, expected 3>
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
