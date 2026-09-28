import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V1, type ExploreFormula } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { isUniqueViolation } from "../auth";
import { SocialError } from "./context";
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
  /** The parent's author and state, so a view can decide whether the viewer may learn the handle. */
  replyToAuthorId: string | null;
  replyToState: StoredPostState | null;
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
  /** When the handle last changed after onboarding, null until then; the next change waits 30 days. */
  handleChangedAt: Date | null;
}

/** How a handle change ended: the handle the profile had before, or why nothing was written. */
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
}

/** Something the account did to a post (a like, a repost, a bookmark), and when. */
export interface PostRefRow {
  postId: string;
  at: Date;
}

/** The other side of a graph relation by the handle it has now (nothing else about them), and since when. */
export interface HandleRefRow {
  handle: string;
  since: Date;
}

/**
 * Where a page of the data export ends: the last row's created_at to the microsecond, as ISO text, and its
 * id (the post's, or the other account's). The next page starts after it. The microseconds matter: a row
 * written by a database default carries them, and a key cut to the millisecond would read such rows twice
 * or skip them.
 */
export interface ExportKey {
  at: string;
  id: string;
}

/** One page of a list for the data export, and the key to read the next one after, or null when this page was the last. */
export interface ExportPage<T> {
  rows: T[];
  next: ExportKey | null;
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

/**
 * What a round of the Explore refresh did: nothing, because the newest ranking is younger than the formula's minimum
 * gap, or a new ranking under `generation` with the posts that passed the candidate predicate, the posts it holds and
 * the milliseconds it took.
 */
export type ExploreRefresh = { skipped: true } | { skipped: false; generation: number; candidates: number; items: number; tookMs: number };

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
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
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
  handle_changed_at: string | null;
}

/** A timestamptz expression as ISO text with milliseconds, in UTC. The expression is a column reference written here, never input. */
const iso = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/** The same with the microseconds a timestamp column holds, for the export's page keys, which must round-trip exactly. */
const isoMicro = (column: string): SQL => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** Rows after `after` in (created_at, id) order: the keyset condition of an export page. Always true for the first page. */
const exportAfter = (after: ExportKey | null, at: SQL, id: SQL): SQL => (after ? sql`(${at}, ${id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : sql`true`);

/** The page a query answered, with its next key when the page is full (a full page may be followed by more). */
function exportPage<R extends { key_at: string; key_id: string }, T>(raw: R[], limit: number, map: (row: R) => T): ExportPage<T> {
  const last = raw.at(-1);
  return { rows: raw.map(map), next: raw.length === limit && last ? { at: last.key_at, id: last.key_id } : null };
}

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
  replyToAuthorId: r.reply_to_author_id,
  replyToState: r.reply_to_state,
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
  handleChangedAt: r.handle_changed_at ? new Date(r.handle_changed_at) : null,
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
  a.handle as author_handle, a.display_name as author_display_name, (a.verified_at is not null) as author_verified,
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_SELECT = sql`select id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at from profiles`;

/** No block in either direction between the viewer and the account `other` names (a column reference). */
const otherNotBlocked = (viewer: string | null, other: SQL): SQL =>
  viewer === null
    ? sql`true`
    : sql`not exists (select 1 from blocks b where (b.blocker_id = ${viewer}::uuid and b.blocked_id = ${other}) or (b.blocked_id = ${viewer}::uuid and b.blocker_id = ${other}))`;

/** The viewer neither blocks, is blocked by, nor mutes the account `other` names. */
const otherWelcome = (viewer: string, other: SQL): SQL =>
  sql`${otherNotBlocked(viewer, other)} and not exists (select 1 from mutes m where m.muter_id = ${viewer}::uuid and m.muted_id = ${other})`;

/** A keyset bound on the three sort columns of a timeline branch. */
const beforeTriple = (cursor: Cursor | undefined, sortAt: SQL, id: SQL, reposter: SQL): SQL =>
  cursor ? sql`(${sortAt}, ${id}, ${reposter}) < (${at(cursor)}::timestamptz, ${cursor.id}::uuid, ${cursor.r ?? NO_REPOSTER}::uuid)` : sql`true`;

/** The outer select of a list query whose inner query `i` carries post_id, sort_at and reposter_id. */
const LIST_COLUMNS = sql`i.post_id, ${iso("i.sort_at")} as sort_at, i.reposter_id`;

export function createSocialRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  const bump = (column: SQLWrapper, delta: 1 | -1): SQL => (delta === 1 ? sql`${column} + 1` : sql`greatest(0, ${column} - 1)`);

  const profileList = async (query: SQL): Promise<ProfileListRow[]> => (await rows<RawProfileListRow>(query)).map(toProfileListRow);

  return {
    // ------------------------------------------------------------ posts

    /**
     * `within` runs in the same transaction once the post exists, which is how its images are attached.
     * `lockWith` names the author of the post replied to or quoted: the pair is locked and a block
     * between them refused inside the transaction, so a reply cannot land across a concurrent block.
     * The author's profile row is locked and a deleted one refused (not_found), and so is the row of the
     * author of the post replied to or quoted (post_unavailable, as for a post that is gone), so no post
     * lands behind a concurrent purge of either account (lockLive).
     */
    async createPost(input: {
      authorId: string;
      body: string;
      replyToId: string | null;
      quoteOfId: string | null;
      now: Date;
      lockWith?: string | null;
      within?: (tx: DbTx, postId: string) => Promise<void>;
    }): Promise<string> {
      return db.transaction(async (tx) => {
        if (input.lockWith) await guardPair(tx, input.authorId, input.lockWith, "post_unavailable");
        await lockLive(tx, sql`id = ${input.authorId}::uuid`);
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
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

    /**
     * `other` is the post's author when that is someone else: the pair is locked and a block refused inside the
     * transaction. The liker's and the author's profile rows are locked too and a deleted one refused, so a like
     * cannot land on an account a concurrent purge is removing (lockLive); the same goes for reposts and bookmarks.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
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
    async repost(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId));
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
      // A transaction of its own only for the lock: a bookmark counts nothing, but it must not outlive a purge of either account.
      return db.transaction(async (tx) => {
        await lockLive(tx, actorAndAuthor(userId, postId));
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        return inserted.length > 0;
      });
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

    /**
     * With `guard`, the pair is locked and a block refused inside the transaction, so a follow cannot land across a
     * concurrent block. Both profile rows are locked and a deleted one refused either way, so a follow cannot land
     * on an account a concurrent purge is removing and stay behind it (lockLive).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockLive(tx, sql`id in (${followerId}::uuid, ${followeeId}::uuid)`);
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

    /**
     * Blocks and, in the same transaction, removes follows, reposts and likes in both directions, so
     * neither account keeps amplifying or counting on the other. False when the block already existed.
     * Both profile rows are locked and a deleted one refused, so a block cannot land behind a concurrent
     * purge of either account (lockLive).
     */
    async block(blockerId: string, blockedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await pairLock(tx, blockerId, blockedId);
        await lockLive(tx, sql`id in (${blockerId}::uuid, ${blockedId}::uuid)`);
        const inserted = await tx.insert(blocks).values({ fromId: blockerId, toId: blockedId, createdAt: now }).onConflictDoNothing().returning({ toId: blocks.toId });
        await removeFollow(tx, blockerId, blockedId);
        await removeFollow(tx, blockedId, blockerId);
        await retractEngagement(tx, blockedId, blockerId);
        await retractEngagement(tx, blockerId, blockedId);
        return inserted.length > 0;
      });
    },
    async unblock(blockerId: string, blockedId: string): Promise<boolean> {
      const deleted = await db.delete(blocks).where(and(eq(blocks.fromId, blockerId), eq(blocks.toId, blockedId))).returning({ toId: blocks.toId });
      return deleted.length > 0;
    },
    /** A transaction of its own only for the lock: a mute counts nothing, but it must not outlive a purge of either account (lockLive). */
    async mute(muterId: string, mutedId: string, now: Date): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockLive(tx, sql`id in (${muterId}::uuid, ${mutedId}::uuid)`);
        const inserted = await tx.insert(mutes).values({ fromId: muterId, toId: mutedId, createdAt: now }).onConflictDoNothing().returning({ toId: mutes.toId });
        return inserted.length > 0;
      });
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

    /** Accounts with a block in either direction with the viewer are left out before the page is cut, so pages stay full. */
    followers(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.follower_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.followee_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.follower_id`)} and ${before(cursor, sql`f.created_at`, sql`f.follower_id`)}
        order by f.created_at desc, f.follower_id desc limit ${limit}`);
    },
    following(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ProfileListRow[]> {
      return profileList(sql`
        select f.followee_id as profile_id, ${iso("f.created_at")} as sort_at from follows f
        where f.follower_id = ${profileId}::uuid and ${otherNotBlocked(viewer, sql`f.followee_id`)} and ${before(cursor, sql`f.created_at`, sql`f.followee_id`)}
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

    /**
     * Top-level posts and quotes by followed accounts and the viewer, plus their reposts; blocks and mutes
     * apply to author and reposter. Each branch applies the cursor, the filters and the limit itself, so
     * only two small sorted sets meet in the union instead of everything the followed accounts ever wrote.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and ${visibleTo(viewer)}
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${beforeTriple(cursor, sql`p.created_at`, sql`p.id`, sql`${NO_REPOSTER}::uuid`)}
          order by p.created_at desc, p.id desc limit ${limit}
        ),
        shared as (
          select r.post_id, r.created_at as sort_at, r.user_id as reposter_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id in (select id from f) and p.state = 'visible'
            and ${otherWelcome(viewer, sql`p.author_id`)} and ${otherWelcome(viewer, sql`r.user_id`)}
            and ${beforeTriple(cursor, sql`r.created_at`, sql`r.post_id`, sql`r.user_id`)}
          order by r.created_at desc, r.post_id desc, r.user_id desc limit ${limit}
        ),
        i as (select * from own union all select * from shared)
        select ${LIST_COLUMNS} from i
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

    // ------------------------------------------------------------ explore

    /**
     * One round of the Explore refresh (2c design, section 7): a new ranking as of `asOf`, written by one statement that
     * takes every number of the formula as a parameter, in a transaction that gives up after 30 seconds of work or 5 of
     * waiting on a lock. The round writes nothing while the newest ranking is younger than the formula's minimum gap, so
     * at most one ranking lands per interval however many instances run the job or restart. The newest `kept` rankings
     * stay, so a reader paging through the one before the current one can finish; older ones go with their items.
     *
     * The statement's CTEs: `c` the candidates (visible top-level posts that are not quotes, by live authors who have not
     * switched Explore off, created in the window up to `asOf`), the one candidate predicate, where later rules about
     * imports, suspension and restoration belong; `e` the engagement that counts (likes and reposts in the window that
     * have stood long enough, by live accounts other than the author that were old enough when they engaged); `ap` the
     * approving accounts per post, each counted once however it engaged, keeping the posts that reach the threshold; `s`
     * the score, approvers over (hours since posted, never negative, + offset) ^ gravity; `r` each author's posts
     * numbered by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts
     * within the per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id;
     * `ins` the items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V1): Promise<ExploreRefresh> {
      const started = performance.now();
      const at = sql`${asOf.toISOString()}::timestamptz`;
      // Durations built in SQL from the formula's numbers, so each number travels as a parameter.
      const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
      const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;
      const since = sql`${at} - ${hours(formula.windowHours)}`;
      const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        const [recent] = (await tx.execute(sql`select exists (select 1 from explore_runs where as_of > ${at} - ${minutes(formula.minGapMinutes)}) as fresh`)) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (
            select p.id, p.author_id, p.created_at from posts p join profiles a on a.id = p.author_id
            where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.created_at > ${since} and p.created_at <= ${at}
              and a.deleted_at is null and a.show_in_explore
          ),
          e as (
            select x.post_id, x.user_id from (
              select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}
              union all
              select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}
            ) x
            join c on c.id = x.post_id
            join profiles u on u.id = x.user_id
            where x.user_id <> c.author_id and u.deleted_at is null and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}
          ),
          ap as (select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${at} - c.created_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
            from ap join c on c.id = ap.post_id
          ),
          r as (select s.post_id, s.author_id, s.score, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank from s),
          k as (
            select r.post_id, r.author_id, row_number() over (order by r.score desc, r.post_id desc) as position
            from r where r.author_rank <= ${formula.perAuthor} order by position limit ${formula.listLength}
          ),
          ins as (insert into explore_items (generation, position, post_id, author_id) select ${generation}::int, k.position, k.post_id, k.author_id from k returning 1)
          select (select count(*) from c)::int as candidates, (select count(*) from ins)::int as items`)) as unknown as { candidates: number; items: number }[];
        // From the start of the round to the end of the ranking statement, the part that grows with the data.
        const tookMs = Math.round(performance.now() - started);
        await tx.execute(sql`update explore_runs set candidates = ${counts!.candidates}, items = ${counts!.items}, took_ms = ${tookMs} where generation = ${generation}`);
        // The newest `kept` rankings stay, this one among them; the cascade takes the items of the others.
        await tx.execute(sql`delete from explore_runs where generation < (select min(generation) from (select generation from explore_runs order by generation desc limit ${formula.kept}) g)`);
        return { skipped: false, generation, candidates: counts!.candidates, items: counts!.items, tookMs };
      });
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

    // ------------------------------------------------------------ the owner's own profile

    /** The owner's own row, which the profile edits start from. A deleted profile is gone for its owner too. */
    async findProfileById(id: string): Promise<ProfileRow | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      return r ? toProfile(r) : null;
    },

    /**
     * The data export's head: the live profile row and every handle in handle_history for it, in the order they
     * were recorded. Null when there is no live profile. The lists come page by page from the reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; handleHistory: string[] } | null> {
      const [r] = await rows<RawProfile>(sql`${PROFILE_SELECT} where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string }>(sql`select handle_lower from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`);
      return { profile: toProfile(r), handleHistory: history.map((row) => row.handle_lower) };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{ id: string; body: string; created_at: string; reply_to_id: string | null; quote_of_id: string | null; state: StoredPostState; deleted_at: string | null; key_at: string; key_id: string }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    },

    /**
     * A page of what the account liked, reposted or bookmarked, in (created_at, post id) order after `after`, for the
     * data export. The table name is one of three fixed literals, never input.
     */
    async exportPostRefs(id: string, table: "likes" | "reposts" | "bookmarks", after: ExportKey | null, limit: number): Promise<ExportPage<PostRefRow>> {
      const raw = await rows<{ post_id: string; at: string; key_at: string; key_id: string }>(sql`
        select post_id, ${iso("created_at")} as at, ${isoMicro("created_at")} as key_at, post_id as key_id from ${sql.raw(table)}
        where user_id = ${id}::uuid and ${exportAfter(after, sql`created_at`, sql`post_id`)} order by created_at, post_id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ postId: row.post_id, at: new Date(row.at) }));
    },

    /**
     * A page of the accounts the account follows, blocks or mutes, by the handle they have now (a deleted account
     * keeps its handle), in (created_at, other id) order after `after`, for the data export. The table and column
     * names are fixed literals of this function, never input.
     */
    async exportHandleRefs(id: string, table: "follows" | "blocks" | "mutes", after: ExportKey | null, limit: number): Promise<ExportPage<HandleRefRow>> {
      const [from, to] = { follows: ["follower_id", "followee_id"], blocks: ["blocker_id", "blocked_id"], mutes: ["muter_id", "muted_id"] }[table];
      const raw = await rows<{ handle: string; since: string; key_at: string; key_id: string }>(sql`
        select p.handle, ${iso("r.created_at")} as since, ${isoMicro("r.created_at")} as key_at, r.${sql.raw(to!)} as key_id
        from ${sql.raw(table)} r join profiles p on p.id = r.${sql.raw(to!)}
        where r.${sql.raw(from!)} = ${id}::uuid and ${exportAfter(after, sql`r.created_at`, sql.raw(`r.${to!}`))}
        order by r.created_at, r.${sql.raw(to!)} limit ${limit}`);
      return exportPage(raw, limit, (row) => ({ handle: row.handle, since: new Date(row.since) }));
    },

    /** Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile. */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
    },

    /**
     * Renames the profile in one transaction. Its row is locked first, so two changes by the same
     * account run one after the other and the second leaves behind the handle the first chose. The
     * new handle must be nobody else's, in profiles (any case) or in handle_history; that check is
     * one statement, so one snapshot: an account leaving a handle moves it from profiles to
     * handle_history in one transaction, and either place shows it as theirs. The handle left behind
     * is reserved in handle_history (it may be there already, from an earlier stint), then the row
     * gets the new handle and the change time. Two accounts racing for a free handle are decided by
     * the unique index on lower(handle): the loser's transaction is rolled back and answers handle_taken.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid and deleted_at is null for update`)) as unknown as { handle: string }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
              or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { taken: boolean }[];
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would).
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "" })
          .where(and(eq(posts.authorId, id), ne(posts.state, "deleted_by_author")));
        await within(tx);
        // The account's own engagement, with the counters of the posts it was on; bookmarks count nothing.
        await tx.execute(sql`
          with gone as (delete from likes where user_id = ${id}::uuid returning post_id)
          update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.execute(sql`
          with gone as (delete from reposts where user_id = ${id}::uuid returning post_id)
          update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
        await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
        // The graph, both ways, with the other side's counters; the account's own counters are zeroed with the row below.
        await tx.execute(sql`
          with gone as (delete from follows where follower_id = ${id}::uuid returning followee_id)
          update profiles set follower_count = greatest(0, follower_count - c.n) from (select followee_id, count(*)::int as n from gone group by followee_id) c where profiles.id = c.followee_id`);
        await tx.execute(sql`
          with gone as (delete from follows where followee_id = ${id}::uuid returning follower_id)
          update profiles set following_count = greatest(0, following_count - c.n) from (select follower_id, count(*)::int as n from gone group by follower_id) c where profiles.id = c.follower_id`);
        await tx.delete(blocks).where(or(eq(blocks.fromId, id), eq(blocks.toId, id)));
        await tx.delete(mutes).where(or(eq(mutes.fromId, id), eq(mutes.toId, id)));
        // The handle stays on the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the row; it may be there already, from an earlier stint.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        // The row stays with its handle; everything else about the person goes. Only a live row is written, so a repeat leaves the deletion time alone.
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
      });
    },
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Serializes the writes between two accounts for the rest of the transaction: follow, block, like,
 * repost, reply and quote all take it, so none of them can land while a block between the pair is
 * being written. The key is the unordered pair, hashed; a collision only means extra waiting.
 */
async function pairLock(tx: Tx, a: string, b: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(least(${a}, ${b})), hashtext(greatest(${a}, ${b})))`);
}

/** Takes the pair lock and refuses, with `code`, when a block exists between the two in either direction. */
async function guardPair(tx: Tx, me: string, other: string, code: "not_found" | "post_unavailable"): Promise<void> {
  if (me === other) return;
  await pairLock(tx, me, other);
  const found = await tx.execute(
    sql`select 1 from blocks where (blocker_id = ${me}::uuid and blocked_id = ${other}::uuid) or (blocker_id = ${other}::uuid and blocked_id = ${me}::uuid) limit 1`,
  );
  if (found.length > 0) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** The profile rows an engagement is about, for lockLive: the account acting and the author of the post (one row when they are the same). */
function actorAndAuthor(userId: string, postId: string): SQL {
  return sql`id = ${userId}::uuid or id = (select author_id from posts where id = ${postId}::uuid)`;
}

/**
 * Locks the profile rows `accounts` selects for the rest of the transaction and refuses the write, with the
 * guard's `code` (not_found unless said), when one of them is deleted. The account purge holds its row `for
 * update` for its whole transaction, so a write that comes second waits and then sees the deletion, and a
 * purge that comes second waits for the write and then removes what it wrote. The lock is `for key share`,
 * the weakest that conflicts with `for update`: `for share` would also conflict with the counter updates
 * these same transactions make on the row (an update takes `for no key update`), so two follows of one
 * account at once would each hold the lock the other's update waits for, and deadlock.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found"): Promise<void> {
  const found = (await tx.execute(sql`select deleted_at from profiles where ${accounts} for key share`)) as unknown as { deleted_at: string | null }[];
  if (found.some((row) => row.deleted_at !== null)) throw new SocialError(code, code === "not_found" ? 404 : 400);
}

/** Removes `userId`'s reposts and likes of `authorId`'s posts and takes them off the counters, in the same transaction. */
async function retractEngagement(tx: Tx, userId: string, authorId: string): Promise<void> {
  await tx.execute(sql`
    with gone as (delete from reposts r using posts p where r.post_id = p.id and r.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning r.post_id)
    update posts set repost_count = greatest(0, repost_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
  await tx.execute(sql`
    with gone as (delete from likes l using posts p where l.post_id = p.id and l.user_id = ${userId}::uuid and p.author_id = ${authorId}::uuid returning l.post_id)
    update posts set like_count = greatest(0, like_count - c.n) from (select post_id, count(*)::int as n from gone group by post_id) c where posts.id = c.post_id`);
}

async function removeFollow(tx: Tx, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await tx.delete(follows).where(and(eq(follows.fromId, followerId), eq(follows.toId, followeeId))).returning({ toId: follows.toId });
  if (deleted.length > 0) {
    await tx.update(profiles).set({ followerCount: sql`greatest(0, ${profiles.followerCount} - 1)` }).where(eq(profiles.id, followeeId));
    await tx.update(profiles).set({ followingCount: sql`greatest(0, ${profiles.followingCount} - 1)` }).where(eq(profiles.id, followerId));
  }
  return deleted.length > 0;
}

export type SocialRepo = ReturnType<typeof createSocialRepo>;
