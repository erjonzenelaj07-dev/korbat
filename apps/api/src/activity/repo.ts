import { sql, type SQL } from "drizzle-orm";
import { ACTIVITY_DEFAULTS, ACTIVITY_KEEP_DAYS, type ActivityPlace, type ActivitySettings, type ActivityTab } from "@korbat/contracts";
import type { Db } from "@korbat/db";

/**
 * The activity module's statements (2d design, sections 5.5 to 5.7, 5.10 and 11.2), through the korbat_api pool. It reads
 * activity_items and activity_state, and the social tables an entry is judged by (the actor's profile, blocks, mutes,
 * follows and the post's state); it writes nothing but activity_state and the retention's deletes. The entries
 * themselves are written by the social module, in the act's transaction.
 *
 * Every time is the database's, written to the microsecond (ActivityTime), so the list's order, the cursor, the newer
 * count and the seen marker compare times of one clock exactly. Keys compare as text in the "C" collation, code unit by
 * code unit, which is how the flow's TypeScript compares them too, so a cursor means the same place to both.
 */

/** A timestamptz expression as ISO text in UTC with its microseconds. The expression is written here, never input. */
const micros = (expression: string): SQL => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** One row of the list before its views: an entry about a post, or a UTC day's follows with the newest three followers. */
export type ActivityRow =
  | { type: "post"; key: string; at: string; kind: "reply" | "mention" | "quote"; postId: string }
  | { type: "follows"; key: string; at: string; count: number; actorIds: string[] };

/**
 * One received entry as the export reads it, ungrouped, with each of 5.5.1's rules answered on its own: whether the actor
 * is deleted, a block stands either way, the recipient mutes the actor, the post is visible, and the follow stands.
 */
export interface ReceivedRow {
  id: string;
  kind: "reply" | "mention" | "quote" | "follow";
  at: string;
  postId: string | null;
  actorHandle: string;
  actorDeleted: boolean;
  blocked: boolean;
  muted: boolean;
  postVisible: boolean;
  followStands: boolean;
}

/**
 * The rules of 5.5.1 as SQL over an entry `i` of `recipient`, each one fragment, written once for the list, the newer
 * count and the export: the actor is live, no block stands between the recipient and the actor in either direction, the
 * recipient does not mute the actor (social/repo.ts's otherWelcome: otherNotBlocked and the mute), a follow's follow
 * still stands, and a post's post is visible (social/repo.ts's visibleTo for a reader who is not its author, since the
 * recipient never wrote it). The views then pass each post through postAccess, as every read of a post does.
 */
const rules = (recipient: string) => ({
  actorLive: sql`exists (select 1 from profiles a where a.id = i.actor_id and a.deleted_at is null)`,
  noBlock: sql`not exists (select 1 from blocks b where (b.blocker_id = ${recipient}::uuid and b.blocked_id = i.actor_id) or (b.blocked_id = ${recipient}::uuid and b.blocker_id = i.actor_id))`,
  notMuted: sql`not exists (select 1 from mutes m where m.muter_id = ${recipient}::uuid and m.muted_id = i.actor_id)`,
  followStands: sql`(i.post_id is not null or exists (select 1 from follows f where f.follower_id = i.actor_id and f.followee_id = ${recipient}::uuid))`,
  postVisible: sql`(i.post_id is null or exists (select 1 from posts p where p.id = i.post_id and p.state = 'visible'))`,
});

/** All five: the entry is shown. */
function shownTo(recipient: string): SQL {
  const r = rules(recipient);
  return sql`${r.actorLive} and ${r.noBlock} and ${r.notMuted} and ${r.followStands} and ${r.postVisible}`;
}

/**
 * The entries of the list as the screen draws them (5.5.1), as one CTE `entries` with key, at, kind, post_id, count and
 * actors: an entry that is not a follow on its own (`e:` and its id, at its time), and the follows of each UTC day as one
 * entry (`f:` and the day, at the newest follow's time, the number of distinct followers and the three newest). A day is
 * a fixed bucket, so a group never splits across pages. Conversations keeps replies, mentions and quotes only.
 */
function entries(recipient: string, tab: ActivityTab): SQL {
  const kinds = tab === "conversations" ? sql`and i.kind::text <> 'follow'` : sql``;
  return sql`
    shown as (
      select i.id, i.kind::text as kind, i.actor_id, i.post_id, i.created_at from activity_items i
       where i.recipient_id = ${recipient}::uuid ${kinds} and ${shownTo(recipient)}
    ),
    entries as (
      select 'e:' || s.id::text as key, s.created_at as at, s.kind, s.post_id, 1 as count, null::uuid[] as actors
        from shown s where s.kind <> 'follow'
      union all
      select 'f:' || to_char(d.day, 'YYYY-MM-DD'), d.at, 'follow', null::uuid, d.count, d.actors
        from (select (s.created_at at time zone 'UTC')::date as day, max(s.created_at) as at, count(distinct s.actor_id)::int as count,
                     (array_agg(s.actor_id order by s.created_at desc, s.actor_id desc))[1:3] as actors
                from shown s where s.kind = 'follow' group by 1) d
    )`;
}

export function createActivityRepo(db: Db) {
  const rows = async <T>(query: SQL): Promise<T[]> => (await db.execute(query)) as unknown as T[];

  return {
    /** A page of the list, newest first by (at, key), after `before` when given, at most `limit` rows. */
    async list(recipient: string, tab: ActivityTab, before: ActivityPlace | null, limit: number): Promise<ActivityRow[]> {
      const raw = await rows<{ key: string; at: string; kind: string; post_id: string | null; count: number; actors: string[] | null }>(sql`
        with ${entries(recipient, tab)}
        select e.key, ${micros("e.at")} as at, e.kind, e.post_id, e.count, e.actors::text[] as actors from entries e
         where ${before === null ? sql`true` : sql`(e.at, e.key collate "C") < (${before.at}::timestamptz, ${before.key} collate "C")`}
         order by e.at desc, e.key collate "C" desc
         limit ${limit}::int`);
      return raw.map((row) =>
        row.kind === "follow"
          ? { type: "follows", key: row.key, at: row.at, count: row.count, actorIds: row.actors ?? [] }
          : { type: "post", key: row.key, at: row.at, kind: row.kind as "reply" | "mention" | "quote", postId: row.post_id! },
      );
    },

    /**
     * How many entries of the list are newer than `since` (every entry when null), counted as the list draws them (a day
     * of follows is one), and at most `cap`: the count stops there, so a busy account costs no more than a quiet one.
     */
    async newer(recipient: string, tab: ActivityTab, since: string | null, cap: number): Promise<number> {
      const [row] = await rows<{ n: number }>(sql`
        with ${entries(recipient, tab)}
        select count(*)::int as n from (select 1 from entries e where ${since === null ? sql`true` : sql`e.at > ${since}::timestamptz`} limit ${cap}::int) x`);
      return row?.n ?? 0;
    },

    /** The stored seen marker, null before the first visit. */
    async seenAt(recipient: string): Promise<string | null> {
      const [row] = await rows<{ seen_at: string | null }>(sql`select ${micros("seen_at")} as seen_at from activity_state where account_id = ${recipient}::uuid`);
      return row?.seen_at ?? null;
    },

    /**
     * Moves the marker to `at`, never back and never past the server's clock (5.7): the later of the stored marker and the
     * earlier of `at` and now(), so a marker older than what another device sent changes nothing. The row is made with the
     * defaults on the first visit; activity_state_guard holds the same two rules.
     */
    async markSeen(recipient: string, at: string): Promise<void> {
      await db.execute(sql`
        insert into activity_state (account_id, seen_at) values (${recipient}::uuid, least(${at}::timestamptz, now()))
        on conflict (account_id) do update set seen_at = greatest(activity_state.seen_at, least(${at}::timestamptz, now()))`);
    },

    /** The account's rules (5.2): its row, or ACTIVITY_DEFAULTS for an account that never changed them. */
    async settings(recipient: string): Promise<ActivitySettings> {
      const [row] = await rows<ActivitySettings>(sql`select replies::text as replies, mentions::text as mentions, quotes::text as quotes, follows from activity_state where account_id = ${recipient}::uuid`);
      return row ? { replies: row.replies, mentions: row.mentions, quotes: row.quotes, follows: row.follows } : { ...ACTIVITY_DEFAULTS };
    },

    /** Stores the four rules, upserting the row (its marker untouched), and answers them as stored. They apply to new acts only. */
    async saveSettings(recipient: string, settings: ActivitySettings): Promise<ActivitySettings> {
      const [row] = await rows<ActivitySettings>(sql`
        insert into activity_state (account_id, replies, mentions, quotes, follows)
        values (${recipient}::uuid, ${settings.replies}::activity_reach, ${settings.mentions}::activity_reach, ${settings.quotes}::activity_reach, ${settings.follows})
        on conflict (account_id) do update set replies = excluded.replies, mentions = excluded.mentions, quotes = excluded.quotes, follows = excluded.follows
        returning replies::text as replies, mentions::text as mentions, quotes::text as quotes, follows`);
      return { replies: row!.replies, mentions: row!.mentions, quotes: row!.quotes, follows: row!.follows };
    },

    /**
     * A page of every entry the account received that korbat still holds, newest first by (created_at, id), after `after`,
     * with the actor's handle now and each rule's answer, for the export (11.2): shown or not, ungrouped.
     */
    async received(recipient: string, after: { at: string; id: string } | null, limit: number): Promise<ReceivedRow[]> {
      const r = rules(recipient);
      const raw = await rows<{
        id: string;
        kind: ReceivedRow["kind"];
        at: string;
        post_id: string | null;
        actor_handle: string;
        actor_deleted: boolean;
        blocked: boolean;
        muted: boolean;
        post_visible: boolean;
        follow_stands: boolean;
      }>(sql`
        select i.id, i.kind::text as kind, ${micros("i.created_at")} as at, i.post_id, a.handle as actor_handle, a.deleted_at is not null as actor_deleted,
               not ${r.noBlock} as blocked, not ${r.notMuted} as muted, ${r.postVisible} as post_visible, ${r.followStands} as follow_stands
          from activity_items i join profiles a on a.id = i.actor_id
         where i.recipient_id = ${recipient}::uuid
           and ${after === null ? sql`true` : sql`(i.created_at, i.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
         order by i.created_at desc, i.id desc
         limit ${limit}::int`);
      return raw.map((row) => ({
        id: row.id,
        kind: row.kind,
        at: row.at,
        postId: row.post_id,
        actorHandle: row.actor_handle,
        actorDeleted: row.actor_deleted,
        blocked: row.blocked,
        muted: row.muted,
        postVisible: row.post_visible,
        followStands: row.follow_stands,
      }));
    },

    /**
     * The retention (5.10): deletes at most `batch` entries written more than ACTIVITY_KEEP_DAYS ago, by id, and answers
     * how many went. activity_items_created_brin finds the old rows; the time is the database's.
     */
    async deleteExpired(batch: number): Promise<number> {
      const gone = await rows<{ id: string }>(sql`
        delete from activity_items where id in (
          select id from activity_items where created_at < now() - make_interval(days => ${ACTIVITY_KEEP_DAYS}::int) order by id limit ${batch}::int)
        returning id`);
      return gone.length;
    },
  };
}

export type ActivityRepo = ReturnType<typeof createActivityRepo>;
