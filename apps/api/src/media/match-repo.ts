import { sql, type SQL } from "drizzle-orm";
import {
  DESTRUCTIVE_DAYS,
  UPLOADS_PAGE_SIZE,
  type MatchCheckState,
  type MatchHashType,
  type MatchKind,
  type MatchRecord,
  type UploadEnd,
  type UploadEndReason,
} from "@korbat/contracts";
import type { Db, DbTx } from "@korbat/db";
import type { ReceivedHashes } from "./files";

/**
 * Every statement on the three tables of the migration known_material (3d design, sections 5, 6.7, 7.8 and 7.12; Task 7):
 * media_hashes, media_matches and upload_refusals, which no file outside the media module names (the architecture test's
 * rule on post_media covers them). The database forces what a record and a refusal mean: media_matches_insert forces
 * `listed` and `acting`, upload_refusals_insert refuses a record that is not acting or an image that is attached and
 * answers refusals_capped over the hour's limit, and upload_refusals_hold holds the image row and the uploader's address.
 * Every time is the database's. Nothing here reads or answers an image file.
 */

/** A connection or a transaction to run a statement on. */
export type Runner = Pick<Db, "execute"> | Pick<DbTx, "execute">;

/** Ids as one uuid[] parameter. */
const uuidArray = (ids: readonly string[]): SQL => sql`${`{${ids.join(",")}}`}::uuid[]`;
/** An instant as ISO text in UTC, to the millisecond. */
const iso = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** An instant as ISO text in UTC, to the microsecond, for a list's cursor. */
const micros = (expression: string) => sql.raw(`to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** An upload's hashes as the comparison reads them, with its check's state, its image's state and where it is. */
export interface HashedUpload {
  mediaId: string;
  ownerId: string;
  status: "processing" | "ready" | "failed";
  postId: string | null;
  checkState: MatchCheckState;
  hashes: ReceivedHashes;
}

/** A match record's row as the readers of this module turn it into a MatchRecord. */
type RawMatch = {
  id: string;
  media_id: string;
  case_id: string | null;
  source: string;
  list_version: string | null;
  hash_type: MatchHashType;
  match_kind: MatchKind;
  classification: string | null;
  listed: boolean;
  acting: boolean;
  queried_at: string;
};

const MATCH_COLUMNS = sql`x.id, x.media_id, x.case_id, x.source, x.list_version, x.hash_type, x.match_kind, x.classification, x.listed, x.acting, ${iso("x.queried_at")} as queried_at`;

const recordOf = (row: RawMatch): MatchRecord => ({
  source: row.source,
  listVersion: row.list_version,
  hashType: row.hash_type,
  matchKind: row.match_kind,
  classification: row.classification,
  listed: row.listed,
  acting: row.acting,
  queriedAt: row.queried_at,
});

/** A refusal as Held uploads lists it, before its release block is read. */
export interface RefusalRow {
  id: string;
  mediaId: string;
  ownerId: string | null;
  refusedAt: string;
  match: MatchRecord;
  otherRefusals: number;
  uploaderGone: boolean;
  objection: string | null;
  objectedAt: string | null;
  endedAt: string | null;
  endAs: UploadEnd | null;
  endReason: UploadEndReason | null;
  deletesAt: string | null;
  reported: boolean;
  releaseId: string | null;
  quarantined: boolean;
}

type RawRefusal = RawMatch & {
  refusal_id: string;
  refusal_media_id: string;
  owner_id: string | null;
  refused_at: string;
  other_refusals: number;
  uploader_gone: boolean;
  objection: string | null;
  objected_at: string | null;
  ended_at: string | null;
  end_as: UploadEnd | null;
  end_reason: UploadEndReason | null;
  deletes_at: string | null;
  notification_id: string | null;
  release_id: string | null;
  quarantined: boolean;
};

/**
 * The refusal's columns with its match and the counts an admin is shown: `other_refusals` counts the same uploader's other
 * refusals whose hold has not ended or ended as report, never one ended as no_report, so a mistake of the source that an
 * admin set aside weighs on nothing later; `deletes_at` is the image row's hold_until after an end as no_report.
 */
const REFUSAL_COLUMNS = sql`${MATCH_COLUMNS}, u.id as refusal_id, u.media_id as refusal_media_id, u.owner_id, ${iso("u.refused_at")} as refused_at,
  (select count(*)::int from public.upload_refusals o
    where o.owner_id = u.owner_id and o.id <> u.id and (o.end_as is null or o.end_as = 'report')) as other_refusals,
  (u.owner_id is null or exists (select 1 from public.profiles p where p.id = u.owner_id and p.deleted_at is not null)) as uploader_gone,
  u.objection, ${iso("u.objected_at")} as objected_at, ${iso("u.ended_at")} as ended_at, u.end_as, u.end_reason,
  case when u.end_as = 'no_report' then ${iso("m.hold_until")} end as deletes_at,
  u.notification_id, u.release_id, public.media_quarantined(u.media_id) as quarantined`;

const refusalOf = (row: RawRefusal): RefusalRow => ({
  id: row.refusal_id,
  mediaId: row.refusal_media_id,
  ownerId: row.owner_id,
  refusedAt: row.refused_at,
  match: recordOf(row),
  otherRefusals: row.other_refusals,
  uploaderGone: row.uploader_gone,
  objection: row.objection,
  objectedAt: row.objected_at,
  endedAt: row.ended_at,
  endAs: row.end_as,
  endReason: row.end_reason,
  deletesAt: row.deletes_at,
  reported: row.notification_id !== null,
  releaseId: row.release_id,
  quarantined: row.quarantined,
});

/** What an uploader's notice reads of their refusal (UploadRefusalView), before the release's time is checked. */
export interface OwnRefusal {
  id: string;
  refusedAt: string;
  source: string;
  hashType: MatchHashType;
  matchKind: MatchKind;
  objection: string | null;
  objectedAt: string | null;
  endedAt: string | null;
  endAs: UploadEnd | null;
  endReason: UploadEndReason | null;
  /** Whether the delay after an end as no_report has passed: until then the uploader is told nothing of that end. */
  delayPassed: boolean;
  releaseId: string | null;
  notificationId: string | null;
}

export function createMatchRepo(db: Db) {
  return {
    /** The pool the statements run on, for a read outside a transaction. */
    db: db as Runner,
    /** A transaction on that pool: finalize's and the retry's, which store an answer with its record and refusal. */
    transaction: <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> => db.transaction(fn),

    // ------------------------------------------------------------ the hashes and the check (7.8)

    /**
     * Step 1's second write: the upload's hashes with its check pending, inside the transaction that inserts its image
     * row, so no image row exists without its hashes while the comparison is on.
     */
    async insertHashes(tx: Runner, mediaId: string, hashes: ReceivedHashes): Promise<void> {
      await tx.execute(sql`
        insert into public.media_hashes (media_id, sha256, sha1, md5, check_state)
        values (${mediaId}::uuid, ${hashes.sha256}::bytea, ${hashes.sha1}::bytea, ${hashes.md5}::bytea, 'pending')`);
    },

    /**
     * 3d Task 8 (design, sections 2 row 33, 5 and 7.14, the retention job's step tools_off): while the comparison is off,
     * every stored row of hashes is deleted in the caller's transaction; answers how many. A match record keeps its one
     * value until its own erasure (erase_automation_records). The step runs only while MEDIA_MATCH is off, so "korbat keeps
     * no fingerprint from a time when it did" is true once it has run.
     */
    async forgetHashes(tx: Runner): Promise<number> {
      const rows = (await tx.execute(sql`delete from public.media_hashes h returning h.media_id`)) as unknown as { media_id: string }[];
      return rows.length;
    },

    /** The upload's hashes and where it stands, or null when it has none (the comparison was off when it came). */
    async hashed(q: Runner, mediaId: string): Promise<HashedUpload | null> {
      const [row] = (await q.execute(sql`
        select h.media_id, m.owner_id, m.status, m.post_id, h.check_state, h.sha256, h.sha1, h.md5
          from public.media_hashes h join public.post_media m on m.id = h.media_id
         where h.media_id = ${mediaId}::uuid`)) as unknown as { media_id: string; owner_id: string; status: HashedUpload["status"]; post_id: string | null; check_state: MatchCheckState; sha256: Buffer; sha1: Buffer; md5: Buffer }[];
      if (!row) return null;
      return { mediaId: row.media_id, ownerId: row.owner_id, status: row.status, postId: row.post_id, checkState: row.check_state, hashes: { sha256: row.sha256, sha1: row.sha1, md5: row.md5 } };
    },

    /** The check's state, when and by which adapter it was last answered. */
    async setCheck(q: Runner, mediaId: string, state: MatchCheckState, source: string | null): Promise<void> {
      await q.execute(sql`update public.media_hashes set check_state = ${state}, checked_at = now(), source = ${source} where media_id = ${mediaId}::uuid`);
    },

    /** One match record; its trigger forces `listed` and `acting`, which are answered with its id. */
    async insertMatch(
      q: Runner,
      record: { mediaId: string; source: string; listVersion: string | null; hashType: MatchHashType; kind: MatchKind; classification: string; hash: Uint8Array },
    ): Promise<{ id: string; listed: boolean; acting: boolean }> {
      const [row] = (await q.execute(sql`
        insert into public.media_matches (media_id, source, list_version, hash_type, match_kind, classification, hash, listed, acting, queried_at)
        values (${record.mediaId}::uuid, ${record.source}, ${record.listVersion}, ${record.hashType}, ${record.kind}, ${record.classification},
                ${Buffer.from(record.hash.buffer, record.hash.byteOffset, record.hash.byteLength)}::bytea, false, false, now())
        returning id, listed, acting`)) as unknown as { id: string; listed: boolean; acting: boolean }[];
      return row!;
    },

    /** A refusal of an upload on no post; its triggers hold it and answer upload_attached, refusal_not_acting or refusals_capped. */
    async insertRefusal(q: Runner, refusal: { mediaId: string; ownerId: string; matchId: string }): Promise<string> {
      const [row] = (await q.execute(sql`
        insert into public.upload_refusals (media_id, owner_id, match_id, refused_at)
        values (${refusal.mediaId}::uuid, ${refusal.ownerId}::uuid, ${refusal.matchId}::uuid, now()) returning id`)) as unknown as { id: string }[];
      return row!.id;
    },

    /**
     * match-retry's read (7.8 step 6): the uploads whose check is unchecked or capped and whose image row is younger than
     * `hours`, the oldest first, at most `limit`.
     */
    async retryDue(limit: number, hours: number): Promise<string[]> {
      const rows = (await db.execute(sql`
        select h.media_id from public.media_hashes h join public.post_media m on m.id = h.media_id
         where h.check_state in ('unchecked', 'capped') and m.created_at > now() - make_interval(hours => ${hours}::int)
         order by m.created_at, m.id limit ${limit}::int`)) as unknown as { media_id: string }[];
      return rows.map((row) => row.media_id);
    },

    /** The ids of these uploads whose check is capped: the sweeper and the owner's status leave them to match-retry. */
    async capped(ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = (await db.execute(sql`select media_id from public.media_hashes where check_state = 'capped' and media_id = any(${uuidArray(ids)})`)) as unknown as { media_id: string }[];
      return new Set(rows.map((row) => row.media_id));
    },

    /** How many uploads wait under the limit on refusals, and how many checks stay unanswered: matcher_down's facts. */
    async checkCounts(): Promise<{ unchecked: number; capped: number; oldestUnchecked: string | null }> {
      const [row] = (await db.execute(sql`
        select (count(*) filter (where h.check_state = 'unchecked'))::int as unchecked, (count(*) filter (where h.check_state = 'capped'))::int as capped,
               ${iso("min(m.created_at) filter (where h.check_state = 'unchecked')")} as oldest
          from public.media_hashes h join public.post_media m on m.id = h.media_id`)) as unknown as { unchecked: number; capped: number; oldest: string | null }[];
      return { unchecked: row!.unchecked, capped: row!.capped, oldestUnchecked: row!.oldest };
    },

    // ------------------------------------------------------------ the match records (6.7, 7.9, 7.11)

    /** The image's unerased match record that the program is not done with, and its unerased one whatever its mark. */
    async recordsOfImages(q: Runner, mediaIds: readonly string[]): Promise<Map<string, { id: string; listed: boolean; acting: boolean; handled: boolean }>> {
      const found = new Map<string, { id: string; listed: boolean; acting: boolean; handled: boolean }>();
      if (mediaIds.length === 0) return found;
      const rows = (await q.execute(sql`
        select distinct on (x.media_id) x.media_id, x.id, x.listed, x.acting, x.handled_at is not null as handled
          from public.media_matches x where x.media_id = any(${uuidArray(mediaIds)}) and x.erased_at is null
         order by x.media_id, (x.handled_at is null) desc, x.queried_at desc, x.id`)) as unknown as { media_id: string; id: string; listed: boolean; acting: boolean; handled: boolean }[];
      for (const row of rows) found.set(row.media_id, { id: row.id, listed: row.listed, acting: row.acting, handled: row.handled });
      return found;
    },

    /** One record, as staff are shown it, with its image and its case; null when there is none. */
    async record(q: Runner, matchId: string): Promise<(MatchRecord & { id: string; mediaId: string; caseId: string | null; handled: boolean; erased: boolean }) | null> {
      const [row] = (await q.execute(sql`select ${MATCH_COLUMNS}, x.handled_at is not null as handled, x.erased_at is not null as erased from public.media_matches x where x.id = ${matchId}::uuid`)) as unknown as (RawMatch & { handled: boolean; erased: boolean })[];
      return row ? { ...recordOf(row), id: row.id, mediaId: row.media_id, caseId: row.case_id, handled: row.handled, erased: row.erased } : null;
    },

    /** The records of these match ids, keyed by id: the case page's signals. */
    async records(matchIds: readonly string[]): Promise<Map<string, MatchRecord>> {
      const found = new Map<string, MatchRecord>();
      if (matchIds.length === 0) return found;
      const rows = (await db.execute(sql`select ${MATCH_COLUMNS} from public.media_matches x where x.id = any(${uuidArray(matchIds)})`)) as unknown as RawMatch[];
      for (const row of rows) found.set(row.id, recordOf(row));
      return found;
    },

    /** Which of these images an unerased match record names: gate V's door, and the case page's [case.image.matched]. */
    async matched(q: Runner, mediaIds: readonly string[]): Promise<Set<string>> {
      if (mediaIds.length === 0) return new Set();
      const rows = (await q.execute(sql`select distinct x.media_id from public.media_matches x where x.media_id = any(${uuidArray(mediaIds)}) and x.erased_at is null`)) as unknown as { media_id: string }[];
      return new Set(rows.map((row) => row.media_id));
    },

    /**
     * The automated step's write (7.9 step 2.2), in its transaction: the record is marked handled and, with a case, names
     * it once (review ruling 8). Its guard lets each column change only from null. 3d review H1: a record marked handled
     * with no case (a mark an older build's conflicting entry wrote while this step ran) still gains the step's case.
     */
    async joined(tx: Runner, matchId: string, caseId: string | null): Promise<void> {
      await tx.execute(sql`
        update public.media_matches set case_id = coalesce(case_id, ${caseId}::uuid), handled_at = coalesce(handled_at, now())
         where id = ${matchId}::uuid and (handled_at is null or (case_id is null and ${caseId}::uuid is not null))`);
    },

    /**
     * 3d review H1: an entry whose signal met the image's existing one marks the record handled with no case, so the
     * sweep does not read it again, but only while no signal names the record. A record a signal names is that signal's
     * step's to mark: marking it here, while the step was in flight or had failed, ended the step as "already" for good.
     */
    async passed(tx: Runner, matchId: string): Promise<void> {
      await tx.execute(sql`
        update public.media_matches x set handled_at = now()
         where x.id = ${matchId}::uuid and x.handled_at is null
           and not exists (select 1 from public.automated_signals s where s.match_id = x.id)`);
    },

    /**
     * The sweep's read of matches (7.9): images on a post whose post is not deleted by its author, ready and not erased,
     * with an unerased match record the program is not done with, acting or a flag; at most `limit`, the oldest first.
     * 3d review H1: not a record a signal names, which the sweep's read of signals retries: a step in flight or one that
     * failed is never raced by this read, and such records never fill its batch.
     */
    async unhandledOnPosts(limit: number): Promise<{ mediaId: string; postId: string; matchId: string }[]> {
      if (limit <= 0) return [];
      const rows = (await db.execute(sql`
        select x.media_id, m.post_id, x.id from public.media_matches x
          join public.post_media m on m.id = x.media_id join public.posts p on p.id = m.post_id
         where x.handled_at is null and x.erased_at is null and m.status = 'ready' and m.erased_at is null and p.state <> 'deleted_by_author'
           and not exists (select 1 from public.automated_signals s where s.match_id = x.id)
         order by x.queried_at, x.id limit ${limit}::int`)) as unknown as { media_id: string; post_id: string; id: string }[];
      return rows.map((row) => ({ mediaId: row.media_id, postId: row.post_id, matchId: row.id }));
    },

    // ------------------------------------------------------------ refusals: the uploader's (7.12 steps 1 and 2)

    /** The refusal of an image, for its owner's status: its id while it names the owner. */
    async refusalOfImage(mediaId: string, ownerId: string): Promise<string | null> {
      const [row] = (await db.execute(sql`select u.id from public.upload_refusals u where u.media_id = ${mediaId}::uuid and u.owner_id = ${ownerId}::uuid`)) as unknown as { id: string }[];
      return row?.id ?? null;
    },

    /** One of the owner's refusals, as its notice reads it; null for any other's. */
    async ownRefusal(ownerId: string, refusalId: string): Promise<OwnRefusal | null> {
      const [row] = (await db.execute(sql`
        select u.id, ${iso("u.refused_at")} as refused_at, x.source, x.hash_type, x.match_kind, u.objection, ${iso("u.objected_at")} as objected_at,
               ${iso("u.ended_at")} as ended_at, u.end_as, u.end_reason,
               (u.end_as is distinct from 'no_report' or u.ended_at + make_interval(hours => r.no_report_hours) <= now()) as delay_passed,
               u.release_id, u.notification_id
          from public.upload_refusals u join public.media_matches x on x.id = u.match_id cross join public.automation_rules() r
         where u.id = ${refusalId}::uuid and u.owner_id = ${ownerId}::uuid`)) as unknown as {
        id: string;
        refused_at: string;
        source: string;
        hash_type: MatchHashType;
        match_kind: MatchKind;
        objection: string | null;
        objected_at: string | null;
        ended_at: string | null;
        end_as: UploadEnd | null;
        end_reason: UploadEndReason | null;
        delay_passed: boolean;
        release_id: string | null;
        notification_id: string | null;
      }[];
      if (!row) return null;
      return {
        id: row.id,
        refusedAt: row.refused_at,
        source: row.source,
        hashType: row.hash_type,
        matchKind: row.match_kind,
        objection: row.objection,
        objectedAt: row.objected_at,
        endedAt: row.ended_at,
        endAs: row.end_as,
        endReason: row.end_reason,
        delayPassed: row.delay_passed,
        releaseId: row.release_id,
        notificationId: row.notification_id,
      };
    },

    /** The owner's refusals, newest first, after a cursor's (time, id), one more than `limit`; with each one's sort key. */
    async refusalsOf(ownerId: string, after: { at: string; id: string } | null, limit: number): Promise<{ id: string; at: string; key: string }[]> {
      return (await db.execute(sql`
        select u.id, ${iso("u.refused_at")} as at, ${micros("u.refused_at")} as key from public.upload_refusals u
         where u.owner_id = ${ownerId}::uuid
           and (${after === null} or (u.refused_at, u.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
         order by u.refused_at desc, u.id desc limit ${limit}::int`)) as unknown as { id: string; at: string; key: string }[];
    },

    /**
     * The one statement that writes an objection (7.12 step 2): only on the owner's refusal, and only while it has none,
     * is not released and did not end as no_report, the rule the guard states too. Answers whether a row changed.
     */
    async object(ownerId: string, refusalId: string, text: string): Promise<boolean> {
      const rows = await db.execute(sql`
        update public.upload_refusals set objection = ${text}, objected_at = now()
         where id = ${refusalId}::uuid and owner_id = ${ownerId}::uuid and objection is null and release_id is null and end_as is distinct from 'no_report'
        returning id`);
      return rows.length === 1;
    },

    /** Whether the owner has a refusal of this id, whatever its state: the route's not_found and objection_not_open. */
    async owns(ownerId: string, refusalId: string): Promise<boolean> {
      const rows = await db.execute(sql`select 1 from public.upload_refusals where id = ${refusalId}::uuid and owner_id = ${ownerId}::uuid`);
      return rows.length === 1;
    },

    /** The refusals whose notice is still owed, the oldest first, with their uploader: the dispatch round's notices. */
    async refusalsUntold(limit: number): Promise<{ id: string; ownerId: string | null; refusedAt: string }[]> {
      const rows = (await db.execute(sql`
        select u.id, u.owner_id, ${iso("u.refused_at")} as refused_at from public.upload_refusals u where u.told = 'pending'
         order by u.refused_at, u.id limit ${limit}::int`)) as unknown as { id: string; owner_id: string | null; refused_at: string }[];
      return rows.map((row) => ({ id: row.id, ownerId: row.owner_id, refusedAt: row.refused_at }));
    },

    /** The outcome of a refusal's notice, which changes only a notice still pending. */
    async refusalTold(refusalId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void> {
      await db.execute(sql`update public.upload_refusals set told = ${outcome}::delivery_state where id = ${refusalId}::uuid and told = 'pending'`);
    },

    /** The ends as no_report whose delay has passed and whose notice that the hold was lifted is still owed. */
    async liftedUntold(limit: number): Promise<{ id: string; ownerId: string | null; endedAt: string }[]> {
      const rows = (await db.execute(sql`
        select u.id, u.owner_id, ${iso("u.ended_at")} as ended_at from public.upload_refusals u cross join public.automation_rules() r
         where u.lifted_told = 'pending' and u.end_as = 'no_report' and u.ended_at + make_interval(hours => r.no_report_hours) <= now()
         order by u.ended_at, u.id limit ${limit}::int`)) as unknown as { id: string; owner_id: string | null; ended_at: string }[];
      return rows.map((row) => ({ id: row.id, ownerId: row.owner_id, endedAt: row.ended_at }));
    },

    /** The outcome of the notice that a hold was lifted, which changes only a notice still pending. */
    async liftedTold(refusalId: string, outcome: "sent" | "suppressed" | "no_address" | "none" | "failed"): Promise<void> {
      await db.execute(sql`update public.upload_refusals set lifted_told = ${outcome}::delivery_state where id = ${refusalId}::uuid and lifted_told = 'pending'`);
    },

    // ------------------------------------------------------------ refusals: staff's (7.12 steps 3 to 5, 8.2, 8.6)

    /**
     * Held uploads (7.12 step 3): the open holds, oldest first (section 0); then those ended as report and not released,
     * oldest first (section 1); then those released or ended as no_report in the last DESTRUCTIVE_DAYS days, newest first
     * (section 2). A page is UPLOADS_PAGE_SIZE + 1 rows from `offset`: the list is short, and its order is the sections'.
     */
    async heldList(offset: number): Promise<RefusalRow[]> {
      const rows = (await db.execute(sql`
        with listed as (
          select u.*, coalesce((select r.released_at from public.releases r where r.id = u.release_id), u.ended_at) as closed_at,
                 case when u.end_as is null then 0 when u.end_as = 'report' and u.release_id is null then 1 else 2 end as section
            from public.upload_refusals u
        )
        select ${REFUSAL_COLUMNS}
          from listed u join public.media_matches x on x.id = u.match_id left join public.post_media m on m.id = u.media_id
         where u.section < 2 or u.closed_at >= now() - make_interval(days => ${DESTRUCTIVE_DAYS}::int)
         order by u.section, case when u.section < 2 then u.refused_at end, u.closed_at desc, u.id
         offset ${offset}::int limit ${UPLOADS_PAGE_SIZE + 1}::int`)) as unknown as RawRefusal[];
      return rows.map(refusalOf);
    },

    /** One refusal as Held uploads shows it; null when there is none. */
    async held(refusalId: string): Promise<RefusalRow | null> {
      const [row] = (await db.execute(sql`
        select ${REFUSAL_COLUMNS}
          from public.upload_refusals u join public.media_matches x on x.id = u.match_id left join public.post_media m on m.id = u.media_id
         where u.id = ${refusalId}::uuid`)) as unknown as RawRefusal[];
      return row ? refusalOf(row) : null;
    },

    /**
     * Home's [home.uploads] and the urgent alert's `heldUploads` (8.2, W.7): the holds no admin has ended, with the oldest
     * refusal; the unanswered objections of a hold that is open or ended as report and not released; and the uploads that
     * wait under the limit on refusals.
     */
    async heldOverview(): Promise<{ open: number; oldest: string | null; objected: number; capped: number }> {
      const [row] = (await db.execute(sql`
        select (count(*) filter (where u.end_as is null))::int as open, ${iso("min(u.refused_at) filter (where u.end_as is null)")} as oldest,
               (count(*) filter (where u.objection is not null and (u.end_as is null or (u.end_as = 'report' and u.release_id is null))))::int as objected,
               (select count(*)::int from public.media_hashes h where h.check_state = 'capped') as capped
          from public.upload_refusals u`)) as unknown as { open: number; oldest: string | null; objected: number; capped: number }[];
      return { open: row!.open, oldest: row!.oldest, objected: row!.objected, capped: row!.capped };
    },

    /** The holds ended as no_report in the last `days` days, newest first: Home's [home.unreported]. */
    async recentUnreported(days: number, max: number): Promise<{ at: string; refusalId: string }[]> {
      const rows = (await db.execute(sql`
        select ${iso("u.ended_at")} as at, u.id from public.upload_refusals u
         where u.end_as = 'no_report' and u.ended_at >= now() - make_interval(days => ${days}::int)
         order by u.ended_at desc, u.id desc limit ${max}::int`)) as unknown as { at: string; id: string }[];
      return rows.map((row) => ({ at: row.at, refusalId: row.id }));
    },

    /** The uploader and the image of a refusal, for the end's and the release's transactions; null when there is none. */
    async refusalSubject(q: Runner, refusalId: string): Promise<{ ownerId: string | null; mediaId: string } | null> {
      const [row] = (await q.execute(sql`select u.owner_id, u.media_id from public.upload_refusals u where u.id = ${refusalId}::uuid`)) as unknown as { owner_id: string | null; media_id: string }[];
      return row ? { ownerId: row.owner_id, mediaId: row.media_id } : null;
    },
  };
}

export type MatchRepo = ReturnType<typeof createMatchRepo>;
