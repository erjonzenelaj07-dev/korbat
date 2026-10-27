import { and, eq, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { EXPLORE_V2, type ExploreFormula, type ImportSource } from "@korbat/contracts";
import { blocks, bookmarks, follows, handleHistory, likes, mutes, posts, profiles, reposts, type Db, type DbTx } from "@korbat/db";
import { handleRefusal, isUniqueViolation } from "../auth";
import { WRITE_CLOCK, closingJudgment, liveNotSuspended, reportsRestrictedAt, suspendedAt } from "../lib/standing";
import { SocialError } from "./context";
import type { Cursor, ExploreCursor } from "./cursor";
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
  /**
   * 3b (design, sections 8.4 and 9.3): an imported post's label from its own columns, the archive's date as its UTC day
   * (never its second); null for a native post and for a tombstone, whose columns are cleared.
   */
  imported: { source: ImportSource; at: string; shortened: boolean } | null;
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
export type HandleChangeResult = { ok: true; from: string } | { ok: false; reason: "not_found" | "unchanged" | "handle_taken" | "handle_retired" | "handle_reserved" | "account_suspended" };

/** A post as its author wrote it, for the data export; a deleted one keeps its row with an empty body and its deletion time. */
export interface ExportedPostRow {
  id: string;
  body: string;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  state: StoredPostState;
  deletedAt: Date | null;
  /** 3b (design, section 11.2): an imported post's source, the date its archive gave it and whether it was shortened. */
  imported: { source: ImportSource; originalCreatedAt: Date; shortened: boolean } | null;
}

/**
 * 3b (design, section 6.5): the import a batch belongs to, as the imports module read it. The batch is written only while
 * the job is still publishing at `cursor`, the post_cursor the caller read.
 */
export interface ImportBatchJob {
  id: string;
  ownerId: string;
  source: ImportSource;
  cursor: number;
}

/** One post of an import's batch, built by the imports module from a line the person's choice keeps (imports/plan.ts). */
export interface ImportBatchPost {
  /** importPostId(seed, ref): derived, so a parent's id is computed and a repeated batch inserts nothing twice. */
  id: string;
  /** importPostId(seed, parent) for a line of the account's own thread, else null; written top-level when that post is not there. */
  parentId: string | null;
  body: string;
  /** The archive's date, ISO in UTC with whole seconds. */
  originalCreatedAt: string;
  shortened: boolean;
  /** The line's key (5.4), 64 lowercase hex. */
  key: string;
  /** The kept images to attach, in order, each with its description (decision 20). */
  images: { id: string; alt: string }[];
}

/** A batch's outcome: nothing written (the import moved on, or another batch wrote it), or the posts it inserted. */
export type ImportBatchResult = { written: false } | { written: true; posts: { id: string; images: boolean }[] };

/** An undo batch's outcome: the posts it found to remove, those it tombstoned, and the image rows that went with them. */
export interface RemoveBatchResult {
  selected: number;
  removed: number;
  images: string[];
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

/** One row of an Explore page: the post, and its place in the ranking, which orders the page and is never answered. */
export interface ExploreRow {
  postId: string;
  position: number;
}

/**
 * What one statement found for a page of Explore: the current generation (null before the first round); the ranking
 * read, the cursor's or else the current one, with its time, when it is kept (null otherwise); the position of the
 * cursor's post in that ranking (null when the ranking does not hold it; 0 without a cursor); and the rows after that
 * position that pass the page's filters, in order, at most the limit asked for.
 */
export interface ExplorePageRead {
  current: number | null;
  ranking: { generation: number; asOf: Date } | null;
  after: number | null;
  rows: ExploreRow[];
}

/**
 * What the author's status needs to know about one post before any judgement: who wrote it, whether it is a reply or a
 * quote, whether it is visible, whether its author is suspended now (3e), whether its author shows in Explore, whether
 * its window has passed at the request time, and the current ranking, if there is one, with its time, its formula's
 * version, whether it holds the post, whether the post was written after it and whether moderation gave the post back
 * after it (3e).
 */
export interface ExploreFacts {
  authorId: string;
  reply: boolean;
  quote: boolean;
  /** 3b (design, sections 8.5 and 10.6): an imported post, which enters no feed on its own. */
  imported: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outsideWindow: boolean;
  ranking: { generation: number; asOf: Date; formula: number; holdsPost: boolean; postIsNewer: boolean; restoredSince: boolean } | null;
}

/**
 * The status's judgement of one post: whether it meets every rule of the formula as of the request time and as of the
 * ranking's time (null when the ranking was computed under another version of the formula, whose rules are not judged),
 * and how many places the ranking gives the post's author and holds in all.
 */
export interface ExploreJudgement {
  metNow: boolean;
  metAtRanking: boolean | null;
  authorPlaces: number;
  places: number;
}

/**
 * The modes a profile row is locked in for a moderation case: a decision's on its subject (3e: `update` when it takes or
 * may start a suspension or a termination, section 5's lock order; `no key update` otherwise), and a report's on its sender.
 */
export type AccountLockMode = "update" | "no key update" | "key share";

/** One row lockAccounts locked: whether its account is deleted, and, read in the same statement by the clock, suspended and restricted in its reports. */
export interface LockedAccount {
  id: string;
  deleted: boolean;
  suspended: boolean;
  reportsRestricted: boolean;
}

/** A post as a case's evidence copies it. `body` is empty when the post's content was erased (`erased`). */
export interface CapturedPost {
  id: string;
  authorId: string;
  authorHandle: string;
  body: string;
  state: StoredPostState;
  createdAt: Date;
  replyToId: string | null;
  quoteOfId: string | null;
  erased: boolean;
}

/** An account's profile fields as a case's evidence copies them. */
export interface CapturedProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  deleted: boolean;
}

interface RawCapturedPost {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  state: StoredPostState;
  created_at: string;
  reply_to_id: string | null;
  quote_of_id: string | null;
  erased: boolean;
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
  reply_to_author_id: string | null;
  reply_to_state: StoredPostState | null;
  import_source: ImportSource | null;
  original_day: string | null;
  import_shortened: boolean | null;
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

/** A row of the Explore page statement: the page's facts on every row, and a post on each row but a lone one for an empty page. */
interface RawExplorePage {
  current: number | null;
  generation: number | null;
  as_of: string | null;
  after: number | null;
  post_id: string | null;
  position: number | null;
}

interface RawExploreFacts {
  author_id: string;
  reply: boolean;
  quote: boolean;
  imported: boolean;
  visible: boolean;
  suspended: boolean;
  shown: boolean;
  outside_window: boolean;
  generation: number | null;
  as_of: string | null;
  formula: number | null;
  holds_post: boolean;
  newer: boolean | null;
  restored: boolean;
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

/** 3b (design, sections 6.2 and 6.5): the five import columns as a tombstone writes them, all null at once, as posts_import_guard allows only there. */
const CLEARED_IMPORT = { importJobId: null, importSource: null, originalCreatedAt: null, importShortened: null, importKey: null } as const;

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
  imported: r.import_source !== null && r.original_day !== null ? { source: r.import_source, at: r.original_day, shortened: r.import_shortened === true } : null,
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
  rp.handle as reply_to_handle, pp.author_id as reply_to_author_id, pp.state as reply_to_state,
  p.import_source::text as import_source, to_char(p.original_created_at at time zone 'UTC', 'YYYY-MM-DD') as original_day, p.import_shortened`;
const POST_JOINS = sql`from posts p join profiles a on a.id = p.author_id left join posts pp on pp.id = p.reply_to_id left join profiles rp on rp.id = pp.author_id`;
const PROFILE_COLUMNS = sql`id, handle, display_name, bio, (verified_at is not null) as verified, follower_count, following_count, post_count, ${iso("created_at")} as created_at, ${iso("handle_changed_at")} as handle_changed_at`;
const PROFILE_SELECT = sql`select ${PROFILE_COLUMNS} from profiles`;

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

/** Durations built in SQL from the formula's numbers, so each number travels as a parameter. */
const hours = (n: number): SQL => sql`(${n}::float8 * interval '1 hour')`;
const minutes = (n: number): SQL => sql`(${n}::float8 * interval '1 minute')`;

/** The one version of the Explore formula whose rules exploreRules writes (3e design, section 7.13). */
const EXPLORE_RULES_VERSION = 2;

/**
 * The time Explore's reads (the page, the chip and the author's status) judge an author's suspension by (3e design,
 * section 7.13 item 6): the database's clock when the statement reads, the same clock a write is judged by. A round
 * judges by its own time instead (exploreRules).
 */
const READ_CLOCK = WRITE_CLOCK;

/**
 * The rules of one Explore formula as of one time (2c design, section 7; 3e design, section 7.13: version 2), as SQL
 * fragments. The refresh ranks with them and the author's status judges one post with them, so the two cannot disagree;
 * the time and every number of the formula travel as parameters. `post` narrows the candidates and the engagement to one
 * post, which the status reads through that post's own indexes; the rules are the same either way. A formula of any
 * other version throws here, before any SQL, so no ranking is stored under a version whose rules were not applied.
 *
 * Version 2's two rules: an account suspended at the time `asOf` (the round's own time, never the clock) is neither a
 * candidate's author nor an engager, by the one predicate of lib/standing.ts applied to rows the round only reads; and a
 * post's window and age count from coalesce(explore_from, created_at), its `starts_at`, where explore_from is created_at
 * plus every span moderation kept the post hidden, which the database's moderation_apply alone writes.
 */
function exploreRules(asOf: Date, formula: ExploreFormula) {
  if (formula.version !== EXPLORE_RULES_VERSION) {
    throw new Error(`Explore's round applies the rules of formula version ${EXPLORE_RULES_VERSION} only, not version ${formula.version}`);
  }
  const at = sql`${asOf.toISOString()}::timestamptz`;
  // A candidate is younger than the window, and only engagement inside the window counts.
  const since = sql`${at} - ${hours(formula.windowHours)}`;
  // Engagement counts once it has stood this long, so a like made just before a round and undone after it never counts.
  const settled = sql`${at} - ${minutes(formula.standingMinutes)}`;
  const onePost = (column: SQL, post?: string): SQL => (post ? sql` and ${column} = ${post}::uuid` : sql.empty());
  /**
   * The one candidate predicate: visible top-level posts that are not quotes, by authors who are live and not suspended
   * at the time and have not switched Explore off, whose starts_at lies in the window up to the time. The window test is
   * written in two arms so that each uses its own index: a post never given back its time by its created_at, a restored
   * one by its explore_from (a partial index holds only those). 3b (design, sections 1.5 and 8.5; decision 8): an imported
   * post is never a candidate; it enters no feed on its own, and is published all at once by design.
   */
  const candidates = (post?: string): SQL => sql`
    select p.id, p.author_id, coalesce(p.explore_from, p.created_at) as starts_at from posts p join profiles a on a.id = p.author_id
    where p.reply_to_id is null and p.quote_of_id is null and p.state = 'visible' and p.import_job_id is null
      and ((p.explore_from is null and p.created_at > ${since} and p.created_at <= ${at}) or (p.explore_from > ${since} and p.explore_from <= ${at}))
      and ${liveNotSuspended("a", at)} and a.show_in_explore${onePost(sql`p.id`, post)}`;
  /**
   * The engagement that counts, read from the candidates `c`: likes and reposts in the window that have stood long enough,
   * by accounts other than the author that are live and not suspended at the time and were old enough when they engaged.
   * The engager is judged at the round, never at the time of the like: a ring's earlier likes stop counting at once.
   */
  const engagement = (post?: string): SQL => sql`
    select x.post_id, x.user_id from (
      select post_id, user_id, created_at from likes where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
      union all
      select post_id, user_id, created_at from reposts where created_at > ${since} and created_at <= ${settled}${onePost(sql`post_id`, post)}
    ) x
    join c on c.id = x.post_id
    join profiles u on u.id = x.user_id
    where x.user_id <> c.author_id and ${liveNotSuspended("u", at)} and u.created_at <= x.created_at - ${hours(formula.engagerMinAgeHours)}`;
  /** The approving accounts per post, read from the engagement `e`: each counted once however it engaged, for the posts that reach the threshold. */
  const approvers = sql`select post_id, count(distinct user_id)::int as approvers from e group by post_id having count(distinct user_id) >= ${formula.threshold}`;
  return {
    at,
    since,
    candidates,
    engagement,
    approvers,
    /**
     * Whether `post` is a candidate that reaches the threshold: the three fragments as the CTEs c, e and ap of a subquery
     * of their own, so one statement can ask at two times.
     */
    met: (post: string): SQL => sql`exists (with c as (${candidates(post)}), e as (${engagement(post)}), ap as (${approvers}) select 1 from ap)`,
  };
}

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
     * lands behind a concurrent purge of either account (lockLive). 3e (design, section 5, the lock order, item 2): the
     * author's row is taken in its own statement, FOR NO KEY UPDATE when its post counter will change (a post or a quote)
     * and FOR KEY SHARE for a reply, with the one predicate on it (account_suspended); the other author's row FOR KEY
     * SHARE: those two modes never wait for each other. A post that both replies and quotes writes two
     * other posts' counters: their rows are taken first, in id order, the order in which a report takes the posts it
     * copies (3c design, section 2, Lock order), so the new post never holds one of them while it waits for the other.
     * The transaction ends with the closing judgment of the author (judgeActing), after `within`: a post that waited at
     * the other author's row, the parent's counter or a foreign key commits only if the author's suspension still has not
     * started.
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
        await lockActing(tx, input.authorId, input.replyToId ? "key share" : "no key update");
        if (input.replyToId || input.quoteOfId) {
          await lockLive(tx, sql`id in (select author_id from posts where id in (${input.replyToId}::uuid, ${input.quoteOfId}::uuid))`, "post_unavailable");
        }
        if (input.replyToId && input.quoteOfId) await lockPostsInOrder(tx, [input.replyToId, input.quoteOfId]);
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
        await judgeActing(tx, input.authorId);
        return row!.id;
      });
    },

    /**
     * Blanks the body and marks the post deleted; adjusts the counters it contributed to. False when there was nothing to
     * delete. `within` runs in the same transaction. The author's profile row is taken first, in the mode the counter
     * update below needs: a decision about the author holds that row before it takes the post, so a deletion that took
     * the post first and the profile second would deadlock with it, and one that takes the profile first waits its turn.
     * Then every post this transaction writes is taken, in id order, before any is written: the post itself and the post
     * it replies to or quotes, whose counter goes down. A report takes the posts it copies for share in that order (3c
     * design, section 2, Lock order), and one of child sexual abuse material about a quoting post reaches the quoted post
     * by itself: a deletion that wrote its own post first and then asked for a quoted post with a lower id would hold
     * what that report asks for next while it waits for what the report holds. The two ids never change, so a plain read
     * names the right rows; only the author's own post is read, so nobody else's request locks anything here.
     */
    async deletePost(id: string, authorId: string, now: Date, within?: (tx: DbTx) => Promise<void>): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${authorId}::uuid for no key update`);
        const [own] = (await tx.execute(sql`select reply_to_id, quote_of_id from posts where id = ${id}::uuid and author_id = ${authorId}::uuid`)) as unknown as {
          reply_to_id: string | null;
          quote_of_id: string | null;
        }[];
        if (!own) return false;
        await lockPostsInOrder(tx, [id, own.reply_to_id, own.quote_of_id]);
        // 3f (design, section 7.10): a post disabled for an order answers its author as a post that does not exist, so its
        // own deletion changes nothing and answers not_found (posts_guard refuses the update for the API role in any case).
        // 3b (design, sections 6.5 and 6.6): the five import columns are cleared in the statement that tombstones, so a
        // deleted imported post keeps nothing of its source (posts_import_guard allows them to change only so).
        const [old] = await tx
          .update(posts)
          .set({ state: "deleted_by_author", deletedAt: now, body: "", ...CLEARED_IMPORT })
          .where(and(eq(posts.id, id), eq(posts.authorId, authorId), ne(posts.state, "deleted_by_author"), ne(posts.state, "disabled")))
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
     * 3e: the liker is the acting account, refused account_suspended while its suspension runs; the author need only be live.
     * Like a repost and a bookmark, it ends with the closing judgment of the acting account (judgeActing), after its
     * counter: the post's row may have kept it waiting past a start.
     */
    async like(userId: string, postId: string, now: Date, other?: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (other) await guardPair(tx, userId, other, "not_found");
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(likes).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: likes.postId });
        if (inserted.length > 0) await tx.update(posts).set({ likeCount: bump(posts.likeCount, 1) }).where(eq(posts.id, postId));
        await judgeActing(tx, userId);
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
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(reposts).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: reposts.postId });
        if (inserted.length > 0) await tx.update(posts).set({ repostCount: bump(posts.repostCount, 1) }).where(eq(posts.id, postId));
        await judgeActing(tx, userId);
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
        await lockLive(tx, actorAndAuthor(userId, postId), "not_found", userId);
        const inserted = await tx.insert(bookmarks).values({ userId, postId, createdAt: now }).onConflictDoNothing().returning({ postId: bookmarks.postId });
        await judgeActing(tx, userId);
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
     * on an account a concurrent purge is removing and stay behind it. 3e (design, section 5, the lock order, item 2):
     * both rows are taken FOR NO KEY UPDATE, the mode the counter updates need, in one statement ordered by id, before
     * the insert; the follower is the acting account and is refused account_suspended while its suspension runs. The one
     * statement projects both rows before it locks either, so a wait for the followee's row leaves the follower's
     * judgment as it was before it: the transaction ends with the closing judgment of the follower (judgeActing).
     */
    async follow(followerId: string, followeeId: string, now: Date, guard = false): Promise<boolean> {
      return db.transaction(async (tx) => {
        if (guard) await guardPair(tx, followerId, followeeId, "not_found");
        await lockPair(tx, followerId, followeeId, followerId);
        const inserted = await tx.insert(follows).values({ fromId: followerId, toId: followeeId, createdAt: now }).onConflictDoNothing().returning({ toId: follows.toId });
        if (inserted.length > 0) {
          await tx.update(profiles).set({ followerCount: bump(profiles.followerCount, 1) }).where(eq(profiles.id, followeeId));
          await tx.update(profiles).set({ followingCount: bump(profiles.followingCount, 1) }).where(eq(profiles.id, followerId));
        }
        await judgeActing(tx, followerId);
        return inserted.length > 0;
      });
    },
    /**
     * 3e (design, section 5, the lock order, item 2): both profile rows FOR NO KEY UPDATE in one statement ordered by id,
     * as a follow takes them, before the delete writes their counters. Withdrawing a follow is open to a suspended account.
     */
    async unfollow(followerId: string, followeeId: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        await lockPair(tx, followerId, followeeId, null);
        return removeFollow(tx, followerId, followeeId);
      });
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
     * 3b (decisions 8 and 23): the own branch reads native posts only (posts_author_native_idx), so a followed account's
     * imported posts never enter; a repost of one is a deliberate act of the reposter's and shows in the other branch.
     */
    async followingTimeline(viewer: string, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with f as (select followee_id as id from follows where follower_id = ${viewer}::uuid union select ${viewer}::uuid),
        own as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id in (select id from f) and p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
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

    /** Every visible top-level native post and quote, newest first (3b: posts_latest_idx holds no imported post); a signed-in viewer's blocks and mutes apply. */
    async latestTimeline(viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select ${LIST_COLUMNS} from (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
        ) i
        where ${itemNotBlocked(viewer)} and ${itemNotMuted(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /**
     * An account's top-level posts, quotes and reposts. The caller has already checked the viewer may see the account. 3b:
     * its own posts are native ones only (the Imported tab lists the others); a repost of an imported post still shows.
     */
    async profilePosts(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        with i as (
          select p.id as post_id, p.created_at as sort_at, null::uuid as reposter_id, p.author_id
          from posts p where p.author_id = ${profileId}::uuid and p.reply_to_id is null and p.import_job_id is null and ${visibleTo(viewer)}
          union all
          select r.post_id, r.created_at, r.user_id, p.author_id
          from reposts r join posts p on p.id = r.post_id where r.user_id = ${profileId}::uuid and p.state = 'visible'
        )
        select ${LIST_COLUMNS} from i
        where ${itemNotBlocked(viewer)} and ${beforeItem(cursor)}
        order by i.sort_at desc, i.post_id desc, coalesce(i.reposter_id, ${NO_REPOSTER}::uuid) desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** An account's Replies tab: its native replies (3b: an imported thread's replies show on their post's page only). */
    async profileReplies(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.reply_to_id is not null and p.import_job_id is null and ${visibleTo(viewer)} and ${before(cursor, sql`p.created_at`, sql`p.id`)}
        order by p.created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /**
     * 3b (design, sections 8.6, 9.2 and 10.6; decision 8): an account's Imported tab: its imported top-level posts, newest
     * first by the archive's date (posts_imported_idx), the page's key that date and the id. The visibility rule and the
     * blocks apply as on the Posts tab; the caller has already checked the viewer may see the account.
     */
    async profileImported(profileId: string, viewer: string | null, cursor: Cursor | undefined, limit: number): Promise<ListRow[]> {
      const raw = await rows<RawListRow>(sql`
        select p.id as post_id, ${iso("p.original_created_at")} as sort_at, null::uuid as reposter_id from posts p
        where p.author_id = ${profileId}::uuid and p.import_job_id is not null and p.reply_to_id is null and ${visibleTo(viewer)} and ${authorNotBlocked(viewer)}
          and ${before(cursor, sql`p.original_created_at`, sql`p.id`)}
        order by p.original_created_at desc, p.id desc limit ${limit}`);
      return raw.map(toListRow);
    },

    /** 3b (9.3, 10.6): whether the account has a visible imported top-level post, so its profile shows the Imported tab to every reader. */
    async hasImported(profileId: string): Promise<boolean> {
      const [row] = await rows<{ found: boolean }>(sql`
        select exists (select 1 from posts p where p.author_id = ${profileId}::uuid and p.import_job_id is not null and p.reply_to_id is null and p.state = 'visible') as found`);
      return row?.found === true;
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
     * waiting on a lock. The round writes nothing while the newest ranking of its formula's version is younger than the
     * formula's minimum gap, so at most one ranking lands per interval however many instances run the job or restart. The
     * newest `kept` rankings stay, so a reader paging through the one before the current one can finish; older ones go
     * with their items. A formula of a version other than 2 throws before the transaction (exploreRules).
     *
     * The statement's CTEs: `c` the candidates, `e` the engagement that counts and `ap` the approving accounts per post
     * reaching the threshold, all three the shared rules of `exploreRules`, which the author's status judges with too; `s`
     * the score, approvers over (hours since the post's window started, never negative, + offset) ^ gravity, the window
     * starting at `starts_at` (3e: when moderation last gave the post back its time, else when it was posted); `r` each author's posts numbered
     * by score, a level of its own because a window cannot order by an alias of its own select; `k` the posts within the
     * per-author cap, numbered by score from 1 and cut at the list length, a tie going to the higher post id; `ins` the
     * items. Nothing about a post but its place is stored, and nothing about any post is answered or logged.
     */
    async refreshExplore(asOf: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreRefresh> {
      const started = performance.now();
      const rules = exploreRules(asOf, formula);
      return db.transaction(async (tx): Promise<ExploreRefresh> => {
        // Settings of this transaction only: every statement below runs on the connection the transaction holds.
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(sql`set local lock_timeout = '5s'`);
        // A ranking later than the minimum gap before `asOf` (one from an instance whose clock runs ahead included) is fresh: the round ends having written nothing.
        // Only a ranking of this formula's version counts (3e design, section 7.13 item 5), so the first round after a
        // change of version ranks at once rather than leave the old rules' ranking up for another gap.
        const [recent] = (await tx.execute(
          sql`select exists (select 1 from explore_runs where as_of > ${rules.at} - ${minutes(formula.minGapMinutes)} and formula = ${formula.version}) as fresh`,
        )) as unknown as { fresh: boolean }[];
        if (recent!.fresh) return { skipped: true };
        // The counts are written once the statement below has them; until the commit nobody sees this row.
        const [run] = (await tx.execute(sql`
          insert into explore_runs (as_of, formula, candidates, items, took_ms) values (${rules.at}, ${formula.version}, 0, 0, 0) returning generation`)) as unknown as { generation: number }[];
        const generation = run!.generation;
        const [counts] = (await tx.execute(sql`
          with c as (${rules.candidates()}),
          e as (${rules.engagement()}),
          ap as (${rules.approvers}),
          s as (
            select c.id as post_id, c.author_id,
              ap.approvers / power(greatest(0, extract(epoch from (${rules.at} - c.starts_at))::float8 / 3600) + ${formula.offsetHours}::float8, ${formula.gravity}::float8) as score
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

    /**
     * A page of Explore (2c design, section 8), read by one statement, so a round that prunes a ranking between the checks
     * and the page cannot turn one answer into another: the current generation; the ranking read (the cursor's, or else
     * the current one) when it is kept, with its time; the position of the cursor's post in it; and after that position,
     * in order, the items whose post is visible (for every reader, its author too), whose author is live, not suspended
     * when the page is read (3e: by the database's clock, so a suspended author's posts leave at the next read and come
     * back with the next round once the suspension ends) and shows in Explore, and, for a signed-in reader, with no block
     * either way between reader and author and no mute of the author.
     * The filters come before the limit, so a page is full whenever the ranking holds that many posts the reader may see.
     * The statement answers one row per post, or a lone row without one for an empty page; the flow decides what a missing
     * ranking or post means.
     */
    async explorePage(viewer: string | null, cursor: ExploreCursor | undefined, limit: number): Promise<ExplorePageRead> {
      const raw = await rows<RawExplorePage>(sql`
        with cur as (select max(generation) as generation from explore_runs),
        run as (select generation, as_of from explore_runs where generation = ${cursor ? sql`${cursor.g}::int` : sql`(select generation from cur)`}),
        pos as (${cursor ? sql`select position from explore_items where generation = ${cursor.g}::int and post_id = ${cursor.id}::uuid` : sql`select 0 as position`}),
        page as (
          select i.post_id, i.position from explore_items i join posts p on p.id = i.post_id join profiles a on a.id = p.author_id
          where i.generation = (select generation from run) and i.position > (select position from pos)
            and p.state = 'visible' and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore and ${viewer ? otherWelcome(viewer, sql`p.author_id`) : sql`true`}
          order by i.position limit ${limit}
        )
        select cur.generation as current, run.generation, ${iso("run.as_of")} as as_of, pos.position as after, page.post_id, page.position
        from cur left join run on true left join pos on true left join page on true
        order by page.position`);
      const head = raw[0]!;
      return {
        current: head.current,
        ranking: head.generation === null ? null : { generation: head.generation, asOf: new Date(head.as_of!) },
        after: head.after,
        rows: raw.filter((row) => row.post_id !== null).map((row) => ({ postId: row.post_id!, position: row.position! })),
      };
    },

    /**
     * What the author's status needs about one post before any judgement (2c design, section 8), as of `now`: the window is
     * the formula's, through the same rules the refresh ranks with, and counts from the post's starts_at (3e: when
     * moderation last gave it back its time, else when it was posted). Whether the author is suspended is read at the
     * database's clock, as the page and the chip read it, so the status says why the post is not shown now. The ranking
     * comes with its formula's version and whether the post was restored after it. Null when there is no such post.
     */
    async exploreFacts(postId: string, now: Date, formula: ExploreFormula = EXPLORE_V2): Promise<ExploreFacts | null> {
      const rules = exploreRules(now, formula);
      const [r] = await rows<RawExploreFacts>(sql`
        with run as (select generation, as_of, formula from explore_runs order by generation desc limit 1)
        select p.author_id, p.reply_to_id is not null as reply, p.quote_of_id is not null as quote, p.import_job_id is not null as imported, p.state = 'visible' as visible,
          ${suspendedAt("a", READ_CLOCK)} as suspended, a.show_in_explore as shown, coalesce(p.explore_from, p.created_at) <= ${rules.since} as outside_window,
          run.generation, ${iso("run.as_of")} as as_of, run.formula, p.created_at > run.as_of as newer, coalesce(p.restored_at > run.as_of, false) as restored,
          exists (select 1 from explore_items i where i.generation = run.generation and i.post_id = p.id) as holds_post
        from posts p join profiles a on a.id = p.author_id left join run on true
        where p.id = ${postId}::uuid`);
      if (!r) return null;
      return {
        authorId: r.author_id,
        reply: r.reply,
        quote: r.quote,
        imported: r.imported,
        visible: r.visible,
        suspended: r.suspended,
        shown: r.shown,
        outsideWindow: r.outside_window,
        ranking:
          r.generation === null
            ? null
            : { generation: r.generation, asOf: new Date(r.as_of!), formula: r.formula!, holdsPost: r.holds_post, postIsNewer: r.newer!, restoredSince: r.restored },
      };
    },

    /**
     * The status's judgement of one post, from one statement about that post alone and never a ranking: whether it meets
     * every rule of the formula (the candidate predicate, the engagement that counts, the threshold) as of `now` and again
     * as of the ranking's time, through the very fragments the refresh ranks with, and how many places the ranking gives
     * the post's author and holds in all. Each count reads at most the ranking's items. A ranking computed under another
     * version of the formula applied other rules, so only `now` is judged then: metAtRanking is null (3e design, section
     * 7.13 item 7).
     */
    async exploreJudgement(
      post: { id: string; authorId: string },
      now: Date,
      ranking: { generation: number; asOf: Date; formula: number },
      formula: ExploreFormula = EXPLORE_V2,
    ): Promise<ExploreJudgement> {
      const sameRules = ranking.formula === formula.version;
      const [r] = await rows<{ met_now: boolean; met_at_ranking: boolean | null; author_places: number; places: number }>(sql`
        select ${exploreRules(now, formula).met(post.id)} as met_now, ${sameRules ? exploreRules(ranking.asOf, formula).met(post.id) : sql`null::boolean`} as met_at_ranking,
          (select count(*) from explore_items where generation = ${ranking.generation}::int and author_id = ${post.authorId}::uuid)::int as author_places,
          (select count(*) from explore_items where generation = ${ranking.generation}::int)::int as places`);
      return { metNow: r!.met_now, metAtRanking: r!.met_at_ranking, authorPlaces: r!.author_places, places: r!.places };
    },

    /**
     * Of the viewer's own posts given, those the current Explore ranking holds while the viewer's switch is on and the
     * viewer is not suspended when this reads (3e: by the database's clock, as the page reads it): with the visible posts
     * only, which the caller passes, exactly those whose status would be listed, and so the posts that carry the author's
     * chip. One statement for any number of posts.
     */
    async listedInExplore(viewer: string, postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) return new Set();
      const raw = await rows<{ post_id: string }>(sql`
        select i.post_id from explore_items i join profiles a on a.id = i.author_id
        where i.generation = (select max(generation) from explore_runs) and i.post_id = any(${uuidArray(postIds)})
          and i.author_id = ${viewer}::uuid and ${liveNotSuspended("a", READ_CLOCK)} and a.show_in_explore`);
      return new Set(raw.map((r) => r.post_id));
    },

    /** Turns "Show my posts in Explore" on or off. False when there is no such live profile. */
    async setShowInExplore(id: string, on: boolean): Promise<boolean> {
      const updated = await db
        .update(profiles)
        .set({ showInExplore: on })
        .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)))
        .returning({ id: profiles.id });
      return updated.length === 1;
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
     * The data export's head: the live profile row, its Explore switch (the owner's, which the profile row the public
     * reads leaves out), and every handle in handle_history for it, in the order they were recorded, with the time korbat
     * retired one that is still retired (3e). Null when there is no live profile. The lists come page by page from the
     * reads below.
     */
    async exportHead(id: string): Promise<{ profile: ProfileRow; showInExplore: boolean; handleHistory: string[]; retiredHandles: { handle: string; retiredAt: Date }[] } | null> {
      const [r] = await rows<RawProfile & { show_in_explore: boolean }>(sql`select ${PROFILE_COLUMNS}, show_in_explore from profiles where id = ${id}::uuid and deleted_at is null`);
      if (!r) return null;
      const history = await rows<{ handle_lower: string; retired_at: string | null }>(
        sql`select handle_lower, ${iso("retired_at")} as retired_at from handle_history where profile_id = ${id}::uuid order by changed_at, handle_lower`,
      );
      return {
        profile: toProfile(r),
        showInExplore: r.show_in_explore,
        handleHistory: history.map((row) => row.handle_lower),
        retiredHandles: history.flatMap((row) => (row.retired_at === null ? [] : [{ handle: row.handle_lower, retiredAt: new Date(row.retired_at) }])),
      };
    },

    /**
     * A page of every post the account wrote, whatever its state, in (created_at, id) order after `after`, for the
     * data export; a deleted one keeps its row with an empty body and its deletion time. The images of the posts
     * belong to the media module; the flow adds them, and lists none of a post that is not here. 3f (design, W.7): a
     * post disabled for an order is left out, with its images, and no line says so; after a reinstatement it is back.
     */
    async exportPosts(id: string, after: ExportKey | null, limit: number): Promise<ExportPage<ExportedPostRow>> {
      const raw = await rows<{
        id: string;
        body: string;
        created_at: string;
        reply_to_id: string | null;
        quote_of_id: string | null;
        state: StoredPostState;
        deleted_at: string | null;
        import_source: ImportSource | null;
        original_created_at: string | null;
        import_shortened: boolean | null;
        key_at: string;
        key_id: string;
      }>(sql`
        select id, body, ${iso("created_at")} as created_at, reply_to_id, quote_of_id, state, ${iso("deleted_at")} as deleted_at,
               import_source::text as import_source, ${iso("original_created_at")} as original_created_at, import_shortened, ${isoMicro("created_at")} as key_at, id as key_id
        from posts where author_id = ${id}::uuid and state::text <> 'disabled' and ${exportAfter(after, sql`created_at`, sql`id`)} order by created_at, id limit ${limit}`);
      return exportPage(raw, limit, (row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        state: row.state,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
        // 3b (11.2): the import's facts on the post; a tombstone's columns are cleared, so it has none.
        imported:
          row.import_source !== null && row.original_created_at !== null
            ? { source: row.import_source, originalCreatedAt: new Date(row.original_created_at), shortened: row.import_shortened === true }
            : null,
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

    /**
     * Sets the display name, the bio, or both (`patch` names at least one). False when there is no such live profile, and
     * (3e, section 7.2) while its suspension runs: the predicate is part of the update's own WHERE, so the update decides.
     * The row is locked first, in a statement of its own: an UPDATE that waited for a holder that only locked the row
     * would keep the judgment it made before the wait, so the UPDATE comes once the row is held and nothing is left to
     * wait for. It is the write's last statement, and so its closing judgment (3e's review).
     */
    async updateProfile(id: string, patch: { displayName?: string; bio?: string }): Promise<boolean> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${id}::uuid for no key update`);
        const updated = await tx
          .update(profiles)
          .set({ ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}), ...(patch.bio !== undefined ? { bio: patch.bio } : {}) })
          .where(and(eq(profiles.id, id), liveNotSuspended("profiles", WRITE_CLOCK)))
          .returning({ id: profiles.id });
        return updated.length === 1;
      });
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
     *
     * 3e (design, section 7.10): a handle korbat retired is nobody's, its former holder's included, so the claim answers
     * handle_retired before it asks whether the handle is free; a handle of the account's own history counts as free
     * only while it is not retired. The database's guard of handles refuses the same, and a placeholder's form, to a
     * change that lost a race with a retirement or skipped the handle rule; its code is answered alike. The locking
     * statement also answers whether the account's suspension runs (3e, section 7.2), and then nothing is written; and the
     * transaction ends with the closing judgment (judgeActing), since the claim's statements can still wait after it.
     */
    async changeHandle(id: string, to: string, now: Date): Promise<HandleChangeResult> {
      try {
        return await db.transaction(async (tx): Promise<HandleChangeResult> => {
          const [current] = (await tx.execute(
            sql`select handle, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${id}::uuid and deleted_at is null for update`,
          )) as unknown as { handle: string; suspended: boolean }[];
          if (!current) return { ok: false, reason: "not_found" };
          if (current.suspended) return { ok: false, reason: "account_suspended" };
          if (current.handle.toLowerCase() === to) return { ok: false, reason: "unchanged" };
          const [claim] = (await tx.execute(sql`
            select exists (select 1 from handle_history where handle_lower = ${to} and retired_at is not null) as retired,
                   exists (select 1 from profiles where lower(handle) = ${to} and id <> ${id}::uuid)
                     or exists (select 1 from handle_history where handle_lower = ${to} and profile_id <> ${id}::uuid) as taken`)) as unknown as { retired: boolean; taken: boolean }[];
          if (claim!.retired) return { ok: false, reason: "handle_retired" };
          if (claim!.taken) return { ok: false, reason: "handle_taken" };
          await tx.insert(handleHistory).values({ handleLower: current.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
          await tx.update(profiles).set({ handle: to, handleChangedAt: now }).where(eq(profiles.id, id));
          await judgeActing(tx, id);
          return { ok: true, from: current.handle };
        });
      } catch (err) {
        // The closing judgment threw to roll the change back: answered as the locking statement answers it.
        if (err instanceof SocialError && (err.code === "account_suspended" || err.code === "not_found")) return { ok: false, reason: err.code };
        const guarded = handleRefusal(err);
        if (guarded !== null) return { ok: false, reason: guarded };
        if (isUniqueViolation(err)) return { ok: false, reason: "handle_taken" };
        throw err;
      }
    },

    // ------------------------------------------------------------ what moderation cases read

    /**
     * Locks these profile rows for the rest of the transaction, in one statement and in id order, so two transactions
     * that lock several accounts never take them in opposite orders. `no key update` is what a decision takes on its
     * subject: two decisions about one account then run one after the other, while the likes and follows of others,
     * which take `key share`, never wait for it. `key share` is what a report takes on its sender. It answers each row
     * found with whether its account is deleted; with `live`, a missing or deleted account is refused (not_found).
     *
     * 3e (design, sections 5 and 7.2): `update` is what a decision takes on its subject when it holds a suspension or a
     * termination, the mode the ledger's trigger takes again: left at `no key update`, the trigger's lock would be an
     * upgrade behind the case's lock, which deadlocks with followers' counter updates. Each row's answer also says whether
     * the account is suspended and whether its reports are restricted, read in the locking statement by the clock, which
     * is what the intake judges a report's sender by.
     */
    async lockAccounts(tx: DbTx, ids: readonly string[], mode: AccountLockMode, live = false): Promise<LockedAccount[]> {
      const wanted = [...new Set(ids)];
      if (wanted.length === 0) return [];
      // The mode is one of three literals of this file, never input.
      const found = (await tx.execute(
        sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended, ${reportsRestrictedAt("profiles", WRITE_CLOCK)} as reports_restricted
              from profiles where id = any(${uuidArray(wanted)}) order by id for ${sql.raw(mode)}`,
      )) as unknown as { id: string; deleted: boolean; suspended: boolean; reports_restricted: boolean }[];
      if (live && (found.length !== wanted.length || found.some((row) => row.deleted))) throw new SocialError("not_found", 404);
      return found.map((row) => ({ id: row.id, deleted: row.deleted, suspended: row.suspended, reportsRestricted: row.reports_restricted }));
    },

    /**
     * A post as a case's evidence copies it, or null when no row has the id: the row is locked `for share`, so the
     * author's deletion comes after the copy or has left its tombstone before it. A post whose content was erased is
     * answered with an empty body, so no copy holds erased text.
     */
    async capturePost(tx: DbTx, postId: string): Promise<CapturedPost | null> {
      const [row] = (await tx.execute(sql`
        select p.id, p.author_id, a.handle as author_handle, p.body, p.state, ${iso("p.created_at")} as created_at, p.reply_to_id, p.quote_of_id,
               p.erased_at is not null as erased
        from posts p join profiles a on a.id = p.author_id where p.id = ${postId}::uuid for share of p`)) as unknown as RawCapturedPost[];
      if (!row) return null;
      return {
        id: row.id,
        authorId: row.author_id,
        authorHandle: row.author_handle,
        body: row.erased ? "" : row.body,
        state: row.state,
        createdAt: new Date(row.created_at),
        replyToId: row.reply_to_id,
        quoteOfId: row.quote_of_id,
        erased: row.erased,
      };
    },

    /** An account's handle, display name and bio as a case's evidence copies them, with whether it is deleted; null when no row has the id. */
    async captureProfile(tx: DbTx, accountId: string): Promise<CapturedProfile | null> {
      const [row] = (await tx.execute(
        sql`select id, handle, display_name, bio, deleted_at is not null as deleted from profiles where id = ${accountId}::uuid`,
      )) as unknown as { id: string; handle: string; display_name: string; bio: string; deleted: boolean }[];
      return row ? { id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, deleted: row.deleted } : null;
    },

    /**
     * The account a handle names, for a report. Without `withDeleted`, only a live profile that holds the handle now: an
     * old handle names nothing, as everywhere else. With it, for a report of child sexual abuse material, also a deleted
     * profile (the purge keeps the handle on the row) and, for a handle no profile holds now, the profile that
     * handle_history records for it: a handle an account has left stays reserved for that account, so it names that
     * account and nobody else.
     */
    async findAccountByHandle(handle: string, withDeleted: boolean): Promise<{ id: string; deleted: boolean } | null> {
      const lower = handle.toLowerCase();
      const [holder] = await rows<{ id: string; deleted: boolean }>(
        sql`select id, deleted_at is not null as deleted from profiles where lower(handle) = ${lower} and (${withDeleted}::boolean or deleted_at is null)`,
      );
      if (holder || !withDeleted) return holder ? { id: holder.id, deleted: holder.deleted } : null;
      const [former] = await rows<{ id: string; deleted: boolean }>(
        sql`select p.id, p.deleted_at is not null as deleted from handle_history h join profiles p on p.id = h.profile_id where h.handle_lower = ${lower}`,
      );
      return former ? { id: former.id, deleted: former.deleted } : null;
    },

    /** Who wrote a post, or null when no row has the id. */
    async postAuthor(postId: string): Promise<string | null> {
      const [row] = await rows<{ author_id: string }>(sql`select author_id from posts where id = ${postId}::uuid`);
      return row?.author_id ?? null;
    },

    /** A post's author, its state and the post it quotes, or null when no row has the id. Nothing is locked. */
    async postRef(postId: string): Promise<{ authorId: string; state: StoredPostState; quoteOfId: string | null } | null> {
      const [row] = await rows<{ author_id: string; state: StoredPostState; quote_of_id: string | null }>(
        sql`select author_id, state, quote_of_id from posts where id = ${postId}::uuid`,
      );
      return row ? { authorId: row.author_id, state: row.state, quoteOfId: row.quote_of_id } : null;
    },

    // ------------------------------------------------------------ imports (3b)

    /**
     * 3b (design, sections 7.5 step 2 and 9.1; decision 24): which of these import keys (64 lowercase hex each, the
     * HMAC of section 5.4) the account's posts carry now, by posts_import_key_idx. The intake counts such a line
     * already_imported and the preview leaves it out. A tombstone keeps no key (6.5), and one an older tombstone still
     * carries is passed over here, so only posts that exist count. Nothing is locked.
     */
    async importedKeys(ownerId: string, keys: readonly string[]): Promise<Set<string>> {
      if (keys.length === 0) return new Set();
      const found = await rows<{ key: string }>(sql`
        select encode(p.import_key, 'hex') as key from posts p
         where p.author_id = ${ownerId}::uuid and p.state <> 'deleted_by_author'
           and p.import_key = any(select decode(k, 'hex') from unnest(string_to_array(${keys.join(",")}, ',')) k)`);
      return new Set(found.map((row) => row.key));
    },

    // ------------------------------------------------------------ imports (3b design, section 6.5)

    /**
     * One batch of an import's posts, in one transaction, in 6.5's order. The author's row FOR NO KEY UPDATE with 3e's
     * predicate (lockActing: a suspended author's batch is refused account_suspended, and the import waits); the job's row
     * FOR UPDATE, which must still be publishing at the cursor the caller read (else nothing is written); the posts of the
     * batch that are there already by id or by key are passed over (a key another import of the account published since
     * the line was read; a repeated batch); every parent outside the batch, taken with lockPostsInOrder as createPost and
     * deletePost take theirs, and a thread line whose parent is neither earlier in the batch nor a post of this import (left
     * out, skipped, or deleted meanwhile, its import columns cleared) is written as a post of its own; one insert of the
     * rest, each created_at the batch's `now` plus its place in the batch in milliseconds (the module's precision, so a
     * thread's replies keep their order in `replies` and its keyset cursor round-trips), on conflict doing nothing, so only
     * the rows RETURNING gave count; the parents' reply counts and the author's post count, one statement each; the images
     * attached through `attach` (the media module's, 6.3's rules); the cursor moved past `lines` and the posts counted; and
     * the closing judgment last. posts_import_guard holds every row to its job, source, dates and parent.
     */
    async publishImportedBatch(
      job: ImportBatchJob,
      batch: { lines: number; posts: readonly ImportBatchPost[] },
      now: Date,
      attach: (tx: DbTx, input: { postId: string; ownerId: string; items: readonly { id: string; alt: string }[] }) => Promise<void>,
    ): Promise<ImportBatchResult> {
      return db.transaction(async (tx) => {
        await lockActing(tx, job.ownerId, "no key update");
        const held = (await tx.execute(
          sql`select j.id from import_jobs j where j.id = ${job.id}::uuid and j.owner_id = ${job.ownerId}::uuid and j.status = 'publishing' and j.post_cursor = ${job.cursor}::int for update of j`,
        )) as unknown as { id: string }[];
        if (held.length === 0) return { written: false };
        let posts = [...batch.posts];
        if (posts.length > 0) {
          const present = (await tx.execute(sql`
            select p.id, encode(p.import_key, 'hex') as key from posts p
             where p.author_id = ${job.ownerId}::uuid
               and (p.id = any(${uuidArray(posts.map((post) => post.id))}) or p.import_key = any(select decode(k, 'hex') from unnest(string_to_array(${posts.map((post) => post.key).join(",")}, ',')) k))`)) as unknown as { id: string; key: string | null }[];
          const ids = new Set(present.map((row) => row.id));
          const keys = new Set(present.flatMap((row) => (row.key === null ? [] : [row.key])));
          posts = posts.filter((post) => !ids.has(post.id) && !keys.has(post.key));
        }
        const own = new Set(posts.map((post) => post.id));
        const outside = [...new Set(posts.flatMap((post) => (post.parentId !== null && !own.has(post.parentId) ? [post.parentId] : [])))];
        await lockPostsInOrder(tx, outside);
        const standing =
          outside.length === 0
            ? new Set<string>()
            : new Set(((await tx.execute(sql`select p.id from posts p where p.id = any(${uuidArray(outside)}) and p.import_job_id = ${job.id}::uuid`)) as unknown as { id: string }[]).map((row) => row.id));
        const earlier = new Set<string>();
        const rows = posts.map((post, place) => {
          const parent = post.parentId !== null && (earlier.has(post.parentId) || standing.has(post.parentId)) ? post.parentId : null;
          earlier.add(post.id);
          return sql`(${post.id}::uuid, ${job.ownerId}::uuid, ${post.body}, ${parent}::uuid, ${new Date(now.getTime() + place).toISOString()}::timestamptz, ${job.id}::uuid,
                      ${job.source}::import_source, ${post.originalCreatedAt}::timestamptz, ${post.shortened}, decode(${post.key}, 'hex'))`;
        });
        const inserted =
          rows.length === 0
            ? []
            : ((await tx.execute(sql`
                insert into posts (id, author_id, body, reply_to_id, created_at, import_job_id, import_source, original_created_at, import_shortened, import_key)
                values ${sql.join(rows, sql`, `)}
                on conflict do nothing
                returning id, reply_to_id`)) as unknown as { id: string; reply_to_id: string | null }[]);
        const replies = new Map<string, number>();
        for (const row of inserted) if (row.reply_to_id !== null) replies.set(row.reply_to_id, (replies.get(row.reply_to_id) ?? 0) + 1);
        if (replies.size > 0) {
          await tx.execute(sql`
            update posts set reply_count = posts.reply_count + c.n
              from (values ${sql.join([...replies].map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const topLevel = inserted.filter((row) => row.reply_to_id === null).length;
        if (topLevel > 0) await tx.execute(sql`update profiles set post_count = post_count + ${topLevel}::int where id = ${job.ownerId}::uuid`);
        const byId = new Map(posts.map((post) => [post.id, post]));
        for (const row of inserted) {
          const images = byId.get(row.id)?.images ?? [];
          if (images.length > 0) await attach(tx, { postId: row.id, ownerId: job.ownerId, items: images });
        }
        await tx.execute(sql`update import_jobs set post_cursor = post_cursor + ${batch.lines}::int, posts_published = posts_published + ${inserted.length}::int where id = ${job.id}::uuid`);
        await judgeActing(tx, job.ownerId);
        return { written: true, posts: inserted.map((row) => ({ id: row.id, images: (byId.get(row.id)?.images.length ?? 0) > 0 })) };
      });
    },

    /**
     * One batch of an import's undo (decision 22), in one transaction, through the author's own deletion path: the author's
     * row FOR NO KEY UPDATE (no predicate: a suspended author may still remove what it posted, as deletePost allows), the
     * job's row while it is undoing; at most `limit` of its posts that are neither deleted nor disabled, by id, and every
     * post they reply to, taken with lockPostsInOrder; the tombstones (deleted_by_author, the body blanked, the five import
     * columns null, a post that changed meanwhile passed over); the counters, one statement each; `detach` for each
     * tombstoned post inside the transaction, whose keep trigger leaves every image a case holds or a frozen post owns; and
     * posts_removed. An empty selection is the caller's sign to move the import to undone. The files of the image rows
     * that went are the caller's to ask for, after the commit.
     */
    async removeImportedBatch(job: { id: string; ownerId: string }, now: Date, limit: number, detach: (tx: DbTx, postId: string) => Promise<string[]>): Promise<RemoveBatchResult> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from profiles where id = ${job.ownerId}::uuid for no key update`);
        const held = (await tx.execute(sql`select j.id from import_jobs j where j.id = ${job.id}::uuid and j.status = 'undoing' for no key update of j`)) as unknown as { id: string }[];
        if (held.length === 0) return { selected: 0, removed: 0, images: [] };
        const batch = (await tx.execute(sql`
          select p.id, p.reply_to_id from posts p
           where p.import_job_id = ${job.id}::uuid and p.state <> 'deleted_by_author' and p.moderation_level <> 'disabled'
           order by p.id limit ${limit}::int`)) as unknown as { id: string; reply_to_id: string | null }[];
        if (batch.length === 0) return { selected: 0, removed: 0, images: [] };
        await lockPostsInOrder(tx, [...batch.map((row) => row.id), ...batch.map((row) => row.reply_to_id)]);
        const gone = (await tx.execute(sql`
          update posts set state = 'deleted_by_author', deleted_at = ${now.toISOString()}::timestamptz, body = '',
                 import_job_id = null, import_source = null, original_created_at = null, import_shortened = null, import_key = null
           where id = any(${uuidArray(batch.map((row) => row.id))}) and import_job_id = ${job.id}::uuid and state <> 'deleted_by_author' and moderation_level <> 'disabled'
          returning id, reply_to_id, quote_of_id`)) as unknown as { id: string; reply_to_id: string | null; quote_of_id: string | null }[];
        const tally = (ids: (string | null)[]) => {
          const counts = new Map<string, number>();
          for (const id of ids) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
          return [...counts];
        };
        const replies = tally(gone.map((row) => row.reply_to_id));
        if (replies.length > 0) {
          await tx.execute(sql`
            update posts set reply_count = greatest(0, posts.reply_count - c.n)
              from (values ${sql.join(replies.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const quotes = tally(gone.map((row) => row.quote_of_id));
        if (quotes.length > 0) {
          await tx.execute(sql`
            update posts set quote_count = greatest(0, posts.quote_count - c.n)
              from (values ${sql.join(quotes.map(([id, n]) => sql`(${id}::uuid, ${n}::int)`), sql`, `)}) c(id, n)
             where posts.id = c.id`);
        }
        const topLevel = gone.filter((row) => row.reply_to_id === null).length;
        if (topLevel > 0) await tx.execute(sql`update profiles set post_count = greatest(0, post_count - ${topLevel}::int) where id = ${job.ownerId}::uuid`);
        const images: string[] = [];
        for (const row of gone) images.push(...(await detach(tx, row.id)));
        await tx.execute(sql`update import_jobs set posts_removed = posts_removed + ${gone.length}::int where id = ${job.id}::uuid`);
        return { selected: batch.length, removed: gone.length, images };
      });
    },

    // ------------------------------------------------------------ deletion

    /**
     * Everything the account owns or is part of in this module goes in one transaction (1b design,
     * section 7.6): its posts become tombstones as after a deletion by the author, with the reply
     * counters of their parents and the quote counters of what they quoted adjusted for those not
     * tombstoned already; its likes, reposts and bookmarks go with the counters of their posts; its
     * follows go in both directions with the other side's counters; its blocks and mutes go in both
     * directions; the profile row stays, anonymised, with its handle, so the handle is never reused.
     * `within` runs in the same transaction, as its last act, for the media rows. The profile row is locked first, so a
     * second purge of the same account (the request's and the job's) waits for the first and then finds
     * nothing left: every statement below changes only what is still there, so a repeat changes nothing.
     * The same lock orders the purge against every write by or about the account (a follow, like, repost,
     * bookmark, block, mute, post, reply or quote), which takes a shared lock on the row (lockLive): one that
     * comes second waits for the purge and is refused, one that comes first makes the purge wait and has what
     * it wrote removed or tombstoned here (a reply or a quote by another account stays, as one written before
     * the deletion would). After the profile row come the row locks of every post of the account, in id order,
     * before any post is written (3c design, section 7.10): a report that holds two of them holds them in that
     * order. What stays unordered are the counters of other accounts' posts that this account replied to, quoted,
     * liked or reposted, which are written after.
     *
     * 3e (design, section 5, the lock order, item 3): right after its own row, the purge takes the rows of every account
     * whose counter it will write (those it follows and its followers) FOR NO KEY UPDATE, in id order, before any post.
     * With the posts first, a decision holding its subject FOR UPDATE, a third account's reply and a follower's purge
     * formed a cycle. An unfollow, a second follow or a quote between the purged account and its own counterparts can
     * still cross it; PostgreSQL detects that, the flows of follow, unfollow and createPost try once more, and the purge
     * is tried again by its job's next round.
     */
    async purgeProfile(id: string, now: Date, within: (tx: DbTx) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`select handle from profiles where id = ${id}::uuid for update`)) as unknown as { handle: string }[];
        await tx.execute(sql`
          select p.id from profiles p
           where p.id <> ${id}::uuid
             and p.id in (select followee_id from follows where follower_id = ${id}::uuid union select follower_id from follows where followee_id = ${id}::uuid)
           order by p.id for no key update`);
        // Every post of the account is locked first, in id order, before any of them is written. A report holds the posts it
        // copies for share in that order, and one about a post that quotes or replies to its author's own post holds two
        // posts of this account. The counter statements below write such a quoted or replied-to post, in their scan's
        // order, and the tombstones write the rest: with the locks taken here, in the report's order, the purge either
        // waits at the first post the report holds, holding none itself, or holds them all before the report asks. The
        // deleted posts are locked too: a live post may quote or reply to one, and its counter is written all the same.
        await tx.execute(sql`select id from posts where author_id = ${id}::uuid order by id for update`);
        // The counters come off first, from the posts about to go, in one statement each: a self-reply's parent is a post of the author's too, and a row may be written once per statement.
        await tx.execute(sql`
          update posts set reply_count = greatest(0, reply_count - c.n)
          from (select reply_to_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and reply_to_id is not null group by reply_to_id) c
          where posts.id = c.reply_to_id`);
        await tx.execute(sql`
          update posts set quote_count = greatest(0, quote_count - c.n)
          from (select quote_of_id, count(*)::int as n from posts where author_id = ${id}::uuid and state <> 'deleted_by_author' and quote_of_id is not null group by quote_of_id) c
          where posts.id = c.quote_of_id`);
        // 3f (design, section 5, the lock order, item 4): the profile row is anonymised (which sets deleted_at) before the
        // tombstones, so posts_guard lets the tombstone of a post disabled for an order through, as it does only for a
        // deleted account. The row is this transaction's from its first statement, so no lock moves. The handle stays on
        // the row and is reserved in handle_history like one left behind, so nobody can take it whatever becomes of the
        // row; it may be there already, from an earlier stint. Only a live row is written, so a repeat leaves the deletion
        // time alone.
        if (row) await tx.insert(handleHistory).values({ handleLower: row.handle.toLowerCase(), profileId: id, changedAt: now }).onConflictDoNothing();
        await tx
          .update(profiles)
          .set({ displayName: "Deleted account", bio: "", avatarPath: null, verifiedAt: null, followerCount: 0, followingCount: 0, postCount: 0, deletedAt: now })
          .where(and(eq(profiles.id, id), isNull(profiles.deletedAt)));
        // The tombstones. The rows are this transaction's already, and no post of the account can appear meanwhile: writing
        // one takes a shared lock on the profile row, which this transaction holds for update. 3b (design, sections 4.7 and
        // 6.6): the five import columns are cleared in the same statement, a disabled post's too (the profile is marked
        // deleted above), and on any tombstone that still carries them, which keeps its deletion time; then no post names
        // an import of the account, whose rows the caller's `within` deletes.
        await tx.execute(sql`
          update posts set state = 'deleted_by_author', deleted_at = case when state = 'deleted_by_author' then deleted_at else ${now.toISOString()}::timestamptz end, body = '',
                 import_job_id = null, import_source = null, original_created_at = null, import_shortened = null, import_key = null
           where author_id = ${id}::uuid and (state <> 'deleted_by_author' or import_job_id is not null)`);
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
        // The media rows go last (3c design, section 7.10): they are the last rows this transaction locks, after every
        // post and profile row it takes, and the requests for their files, which cannot be rolled back, are written as
        // close to the commit as they can be.
        await within(tx);
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

/**
 * Takes these posts' rows, in id order and in one statement, in the mode an update of a counter or of the state takes
 * them: what a transaction that writes more than one post does before it writes the first, so that every such
 * transaction and every report that copies the same posts (for share, in id order) meet at the lowest post they share,
 * where the one that comes second holds none of the others yet. An id no post has locks nothing.
 */
async function lockPostsInOrder(tx: Tx, ids: readonly (string | null)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return;
  await tx.execute(sql`select id from posts where id = any(${uuidArray(wanted)}) order by id for no key update`);
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
 *
 * 3e (design, section 7.2): `acting` is the account that writes (the engager of a like, a repost or a bookmark); the
 * locking statement answers for each row whether its suspension runs, and the write is refused account_suspended when the
 * acting account's does. Any other row need only be live. A block and a mute name no acting account: both stay open.
 */
async function lockLive(tx: Tx, accounts: SQL, code: "not_found" | "post_unavailable" = "not_found", acting: string | null = null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where ${accounts} for key share`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (found.some((row) => row.deleted)) throw new SocialError(code, code === "not_found" ? 404 : 400);
  if (acting !== null && found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
}

/**
 * The author's own row for a new post, in its own statement and in the mode its counter needs (3e design, section 5, the
 * lock order, item 2), with the predicate on it: a deleted author is refused not_found, a suspended one account_suspended.
 */
async function lockActing(tx: Tx, accountId: string, mode: "no key update" | "key share"): Promise<void> {
  // The mode is one of two literals of this file, never input.
  const [row] = (await tx.execute(
    sql`select deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id = ${accountId}::uuid for ${sql.raw(mode)}`,
  )) as unknown as { deleted: boolean; suspended: boolean }[];
  if (!row || row.deleted) throw new SocialError("not_found", 404);
  if (row.suspended) throw new SocialError("account_suspended", 403);
}

/**
 * The closing judgment of a write of `accountId` (lib/standing.ts): the transaction's last statement. A deleted account is
 * refused not_found, a suspended one account_suspended, either of which rolls the write back.
 */
async function judgeActing(tx: Tx, accountId: string): Promise<void> {
  const judged = await closingJudgment(tx, accountId);
  if (!judged || judged.deleted) throw new SocialError("not_found", 404);
  if (judged.suspended) throw new SocialError("account_suspended", 403);
}

/**
 * Both profile rows of a follow or an unfollow FOR NO KEY UPDATE, the mode their counter updates take, in one statement
 * ordered by id (3e design, section 5, the lock order, item 2). A deleted row is refused not_found when `acting` is given
 * (a follow), and the acting account's running suspension account_suspended; an unfollow refuses neither.
 */
async function lockPair(tx: Tx, a: string, b: string, acting: string | null): Promise<void> {
  const found = (await tx.execute(
    sql`select id, deleted_at is not null as deleted, ${suspendedAt("profiles", WRITE_CLOCK)} as suspended from profiles where id in (${a}::uuid, ${b}::uuid) order by id for no key update`,
  )) as unknown as { id: string; deleted: boolean; suspended: boolean }[];
  if (acting === null) return;
  if (found.some((row) => row.deleted)) throw new SocialError("not_found", 404);
  if (found.some((row) => row.id === acting && row.suspended)) throw new SocialError("account_suspended", 403);
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
